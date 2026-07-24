import express, { Router } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import AppDataSource from "~/server/database/datasource";
import type { IUser } from "~/server/database/models/user";
import { requireAuth } from "~/server/middleware/auth";
import { validateBody } from "~/server/middleware/validateBody";
import { webauthnLoginLimiter } from "~/server/middleware/rateLimiter";
import { getWebauthnConfig } from "~/server/util/requestOrigin";
import { maskEmail } from "~/server/util/maskEmail";
import { sendEmail, escapeHtml } from "~/server/util/mailing";
import { isLockedOut, recordFailure } from "~/server/util/authLockout";
import { establishSession } from "~/server/util/sessionEstablish";
import {
  WebauthnRegisterOptionsSchema,
  WebauthnRegisterVerifySchema,
  WebauthnAuthenticationVerifySchema,
} from "~/shared/schemas/webauthn";
import * as webauthnCredentials from "~/server/util/routes/webauthnCredential";

// Extend express-session types to include the WebAuthn ceremony challenge —
// mirrors the existing req.session.oauthState pattern in session.ts.
declare module "express-session" {
  // eslint-disable-next-line no-unused-vars
  interface SessionData {
    webauthnChallenge?: string;
  }
}

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

async function getRequestUser(email: string) {
  const dataSource = await AppDataSource.getInstance();
  return dataSource.getRepository<IUser>("User").findOneBy({ email });
}

router.post(
  "/register/options",
  requireAuth,
  validateBody(WebauthnRegisterOptionsSchema),
  async (req, res, next) => {
    try {
      const email = req.session.user as string;
      const user = await getRequestUser(email);
      if (!user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const existing = await webauthnCredentials.findByUserId(user.id);
      const { rpID } = getWebauthnConfig();
      const options = await generateRegistrationOptions({
        rpName: "Tesla Powerwall Automation",
        rpID,
        userName: email,
        userDisplayName: email,
        attestationType: "none",
        excludeCredentials: existing.map((cred) => ({
          id: cred.credential_id,
          transports: cred.transports as
            AuthenticatorTransportFuture[] | undefined,
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      req.session.webauthnChallenge = options.challenge;
      res.json(options);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/register/verify",
  requireAuth,
  validateBody(WebauthnRegisterVerifySchema),
  async (req, res, next) => {
    const email = req.session.user as string;
    const expectedChallenge = req.session.webauthnChallenge;
    req.session.webauthnChallenge = undefined;
    try {
      if (!expectedChallenge) {
        res.status(400).json({ error: "No registration in progress" });
        return;
      }

      const user = await getRequestUser(email);
      if (!user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { rpID, expectedOrigin } = getWebauthnConfig();
      const { nickname, ...response } = req.body;
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: "Registration could not be verified" });
        return;
      }

      const { credential, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;
      await webauthnCredentials.create({
        userId: user.id,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        nickname,
      });

      authLog.info(
        {
          event: "auth.webauthn.registered",
          userId: user.id,
          email: maskEmail(email),
        },
        "Passkey registered",
      );

      const nicknameLabel = nickname ? ` ("${nickname}")` : "";
      await sendEmail(
        "A new passkey was added to your account",
        `A new passkey${nicknameLabel} was just registered for Face ID / passkey sign-in on your Tesla Powerwall Automation account.\n\nIf this wasn't you, remove it from Account Settings immediately and change your password.`,
        email,
        true,
        `<p>A new passkey${nickname ? ` ("${escapeHtml(nickname)}")` : ""} was just registered for Face ID / passkey sign-in on your Tesla Powerwall Automation account.</p><p>If this wasn't you, remove it from Account Settings immediately and change your password.</p>`,
      );

      res.json({ verified: true });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/login/options", webauthnLoginLimiter, async (req, res, next) => {
  try {
    const { rpID } = getWebauthnConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    req.session.webauthnChallenge = options.challenge;
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/login/verify",
  webauthnLoginLimiter,
  validateBody(WebauthnAuthenticationVerifySchema),
  async (req, res, next) => {
    const expectedChallenge = req.session.webauthnChallenge;
    req.session.webauthnChallenge = undefined;
    const ip = req.ip;
    try {
      if (!expectedChallenge) {
        res.status(400).json({ error: "No login in progress" });
        return;
      }

      const stored = await webauthnCredentials.findByCredentialId(req.body.id);
      const user = stored
        ? await (
            await AppDataSource.getInstance()
          )
            .getRepository<IUser>("User")
            .findOneBy({ id: stored.user_id })
        : null;
      if (!stored || !user) {
        res.status(401).json({ error: "Passkey not recognized" });
        return;
      }
      const email = user.email;

      if (await isLockedOut(email)) {
        authLog.warn(
          { event: "auth.login.locked", email: maskEmail(email), ip },
          "Login blocked: account temporarily locked",
        );
        res.status(429).json({
          error: "Account temporarily locked. Try again in 15 minutes.",
        });
        return;
      }

      const { rpID, expectedOrigin } = getWebauthnConfig();
      const credential: WebAuthnCredential = {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: stored.sign_counter,
        transports: stored.transports as
          AuthenticatorTransportFuture[] | undefined,
      };
      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential,
      });

      if (!verification.verified) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            userId: user.id,
            email: maskEmail(email),
            ip,
            reason: "webauthn_not_verified",
          },
          "Passkey login failed: assertion not verified",
        );
        res.status(401).json({ error: "Passkey verification failed" });
        return;
      }

      await webauthnCredentials.recordUse(
        stored.id,
        verification.authenticationInfo.newCounter,
      );

      const result = await establishSession(req, email);
      authLog.info(
        {
          event: "auth.login.success",
          userId: user.id,
          email: maskEmail(email),
          ip,
          method: "webauthn",
        },
        "Login successful",
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/credentials", requireAuth, async (req, res, next) => {
  try {
    const email = req.session.user as string;
    const user = await getRequestUser(email);
    if (!user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const credentials = await webauthnCredentials.findByUserId(user.id);
    res.json({
      credentials: credentials.map((cred) => ({
        id: cred.id,
        credentialId: cred.credential_id,
        nickname: cred.nickname,
        deviceType: cred.device_type,
        backedUp: cred.backed_up,
        transports: cred.transports,
        createdAt: cred.creation_time,
        lastUsedAt: cred.last_used_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/credentials/:id", requireAuth, async (req, res, next) => {
  try {
    const email = req.session.user as string;
    const user = await getRequestUser(email);
    if (!user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deleted = await webauthnCredentials.deleteForUser(
      req.params.id,
      user.id,
    );
    if (!deleted) {
      res.status(404).json({ error: "Passkey not found" });
      return;
    }

    authLog.info(
      {
        event: "auth.webauthn.removed",
        userId: user.id,
        email: maskEmail(email),
      },
      "Passkey removed",
    );

    const nicknameLabel = deleted.nickname ? ` ("${deleted.nickname}")` : "";
    await sendEmail(
      "A passkey was removed from your account",
      `A passkey${nicknameLabel} was just removed from your Tesla Powerwall Automation account.\n\nIf this wasn't you, please review your account security.`,
      email,
      true,
      `<p>A passkey${deleted.nickname ? ` ("${escapeHtml(deleted.nickname)}")` : ""} was just removed from your Tesla Powerwall Automation account.</p><p>If this wasn't you, please review your account security.</p>`,
    );

    res.json({ message: "Passkey removed" });
  } catch (error) {
    next(error);
  }
});
