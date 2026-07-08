import express from "express";
import argon2 from "argon2";
import { totp, generateKey } from "otp-io";
import {
  sendCodeLimiter,
  verifyCodeLimiter,
} from "~/server/middleware/rateLimiter";
import { randomBytes } from "otp-io/crypto";
import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import { sendEmail } from "~/server/util/mailing";
import { hmac } from "~/server/util/totp";
import type { ISignupVerification } from "../database/models/signupVerification";
import { validateBody } from "~/server/middleware/validateBody";
import { SendCodeSchema, VerifyCodeSchema } from "~/shared/schemas/auth";
import { getAppUrl } from "~/server/util/requestOrigin";
import { escapeHtml } from "~/server/util/mailing";

const authLog = logger.child({ service: "auth" });

export const router = express.Router();

// A self-signup user is already on the login page waiting for this code, so a
// short window is fine. Delegate invites (see userAdmin.ts) pass their own,
// longer TTL — an invitee has to notice the email first, possibly much later.
export const SELF_SIGNUP_CODE_TTL_MINUTES = 15;

// Generates a verification code, stores it, and emails it — shared by the
// public self-signup /send-code endpoint and the User Admin delegate invite
// flow (see src/server/routes/userAdmin.ts), which differ in wording and TTL.
export async function generateAndSendCode(
  email: string,
  buildEmail: (_code: string) => {
    subject: string;
    text: string;
    html?: string;
  },
  ttlMinutes: number = SELF_SIGNUP_CODE_TTL_MINUTES,
): Promise<void> {
  const secret = generateKey(randomBytes, 20);
  const code = await totp(hmac, { secret });
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await upsert({ email, code: await argon2.hash(code), expires_at: expiresAt });
  const { subject, text, html } = buildEmail(code);
  await sendEmail(subject, text, email, true, html);
}

router.post(
  "/send-code",
  sendCodeLimiter,
  validateBody(SendCodeSchema),
  async (req, res, next) => {
    const { email } = req.body;

    const repo = (await AppDataSource.getInstance()).getRepository("User");
    const existingUser = await repo.findOneBy({ email });
    // A placeholder row (created by a pending delegate invite) has an empty
    // password_hash sentinel — only a REAL completed signup should block a
    // resend, otherwise a pending invite could never receive its code.
    if (existingUser && existingUser.password_hash !== "") {
      res.json({ message: "Verification code sent" });
      return;
    }

    try {
      // Same deep link as the delegate invite email (see userAdmin.ts) — costs
      // nothing on the common same-tab path and helps if this is opened on a
      // different device or the original tab got closed.
      const signupUrl = `${getAppUrl(req)}/login?signup=1&email=${encodeURIComponent(email)}`;
      await generateAndSendCode(email, (code) => ({
        subject: "Your Tesla Powerwall Automation verification code",
        text: `Your verification code is: ${code}\n\nThis code is valid for ${SELF_SIGNUP_CODE_TTL_MINUTES} minutes.\n\nContinue signup: ${signupUrl}`,
        html: `<p>Your verification code is: <strong>${code}</strong></p>
<p>This code is valid for ${SELF_SIGNUP_CODE_TTL_MINUTES} minutes.</p>
<p><a href="${escapeHtml(signupUrl)}">Continue signup</a></p>`,
      }));
      res.json({ message: "Verification code sent" });
    } catch (error) {
      authLog.error(
        { err: error, email: email },
        "Sending verification code failed",
      );
      next(error);
    }
  },
);

async function upsert(record: ISignupVerification) {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "SignupVerification",
  );
  const { email, code, expires_at } = record;
  const existingSignupVerification = await repo.findOneBy({ email });
  const id = existingSignupVerification ? existingSignupVerification.id : v4();
  const newDate = new Date();
  let status;
  if (!existingSignupVerification) {
    repo.insert({
      id,
      creation_time: newDate,
      modified_time: newDate,
      email,
      code,
      expires_at,
    });
    status = 200;
  } else {
    const updateFields: Record<string, any> = { modified_time: newDate };
    if (code !== undefined) updateFields.code = code;
    if (expires_at !== undefined) updateFields.expires_at = expires_at;
    repo.update(existingSignupVerification.id, updateFields);
    status = 201;
  }
  return {
    status,
    email,
    action: status === 200 ? "create" : "update",
  };
}

router.post(
  "/verify-code",
  verifyCodeLimiter,
  validateBody(VerifyCodeSchema),
  async (req, res) => {
    const { email, code } = req.body;

    const repo = (await AppDataSource.getInstance()).getRepository(
      "SignupVerification",
    );
    const existingSignupVerification = await repo.findOneBy({ email });

    if (!existingSignupVerification) {
      res.status(404).json({ error: "Verification record not found" });
      return;
    }

    const { code: storedCode, expires_at } = existingSignupVerification;

    let isValid: boolean;
    try {
      isValid = await argon2.verify(storedCode, code);
    } catch {
      isValid = false;
    }
    if (!isValid) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    if (expires_at < new Date()) {
      res.status(410).json({ error: "Verification code expired" });
      return;
    }

    res.json({ message: "Verification code is valid" });
  },
);

export default router;
