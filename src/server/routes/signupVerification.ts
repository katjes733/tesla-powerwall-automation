import express from "express";
import { timingSafeEqual } from "crypto";
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

export const router = express.Router();

router.post("/send-code", sendCodeLimiter, async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }

  const repo = (await AppDataSource.getInstance()).getRepository("User");
  const existingUser = await repo.findOneBy({ email });
  if (existingUser) {
    res.json({ message: "Verification code sent" });
    return;
  }

  const secret = generateKey(randomBytes, 20);
  const code = await totp(hmac, { secret });
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

  upsert({ email, code, expires_at: expiresAt })
    .then(() =>
      sendEmail(
        "Your Tesla Powerwall Automation verification code",
        `Your verification code is: ${code}\n\nThis code is valid for 15 minutes.`,
        email,
      )
        .then(() => {
          res.json({ message: "Verification code sent" });
        })
        .catch((error) => {
          logger.error(`❌ Sending verification code failed: ${error.message}`);
          next(error);
        }),
    )
    .catch((error) => {
      logger.error(`❌ ${error.message}.`);
      next(error);
    });
});

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

router.post("/verify-code", verifyCodeLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    res.status(400).json({ error: "Email and code are required" });
    return;
  }

  const repo = (await AppDataSource.getInstance()).getRepository(
    "SignupVerification",
  );
  const existingSignupVerification = await repo.findOneBy({ email });

  if (!existingSignupVerification) {
    res.status(404).json({ error: "Verification record not found" });
    return;
  }

  const { code: storedCode, expires_at } = existingSignupVerification;

  if (!timingSafeEqual(Buffer.from(code), Buffer.from(storedCode))) {
    res.status(400).json({ error: "Invalid verification code" });
    return;
  }

  if (expires_at < new Date()) {
    res.status(410).json({ error: "Verification code expired" });
    return;
  }

  res.json({ message: "Verification code is valid" });
});

export default router;
