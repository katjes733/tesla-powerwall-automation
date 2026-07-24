import express, { Router } from "express";
import argon2 from "argon2";
import AppDataSource from "~/server/database/datasource";
import type { IUser } from "~/server/database/models/user";
import { loginLimiter } from "~/server/middleware/rateLimiter";
import { maskEmail } from "~/server/util/maskEmail";
import { validateBody } from "~/server/middleware/validateBody";
import { LoginSchema } from "~/shared/schemas/auth";
import { getPendingSignup } from "~/server/util/pendingSignup";
import { isLockedOut, recordFailure } from "~/server/util/authLockout";
import {
  buildSessionUser,
  establishSession,
} from "~/server/util/sessionEstablish";

// Extend express-session types to include 'expiry'
declare module "express-session" {
  // eslint-disable-next-line no-unused-vars
  interface SessionData {
    expiry?: number;
    user?: any;
    oauthState?: { value: string; email: string; expiresAt: number };
  }
}

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

router.post(
  "/login",
  loginLimiter,
  validateBody(LoginSchema),
  async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;
    authLog.info(
      { event: "auth.login.attempt", email: maskEmail(email), ip },
      "Login attempt",
    );

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

    try {
      const dataSource = await AppDataSource.getInstance();
      const userRepo = dataSource.getRepository<IUser>("User");
      const user = await userRepo.findOneBy({ email });
      // A login with no users row yet may still be a pending self-signup
      // (password set, Tesla OAuth not completed) held in Redis — see
      // src/server/util/pendingSignup.ts. Letting them log in is what lets
      // them reach Maintenance to actually complete that OAuth flow.
      const pending = user ? null : await getPendingSignup(email);
      const passwordHash = user?.password_hash ?? pending?.passwordHash;
      if (!passwordHash) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            email: maskEmail(email),
            ip,
            reason: "user_not_found",
          },
          "Login failed: user not found",
        );
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const isValid = await argon2.verify(passwordHash, password);
      if (!isValid) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            userId: user?.id,
            email: maskEmail(email),
            ip,
            reason: "invalid_password",
          },
          "Login failed: invalid password",
        );
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const result = await establishSession(req, email);
      authLog.info(
        {
          event: "auth.login.success",
          userId: user?.id,
          email: maskEmail(email),
          ip,
        },
        "Login successful",
      );
      res.json(result);
      return;
    } catch (error: any) {
      authLog.error(
        { event: "auth.login.error", email: maskEmail(email), ip, err: error },
        "Login error",
      );
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/me", async (req, res) => {
  if (req.session?.user) {
    res.json({
      user: await buildSessionUser(req.session.user),
      sessionExpiry: req.session.expiry,
    });
    return;
  }
  authLog.debug("Identification failed — no authenticated user");
  res.status(401).json({ message: "Not authenticated." });
});

// router.post("/extend", (req, res) => {
//   if (req.session?.user) {
//     req.session.cookie.maxAge =
//       parseInt(process.env.SESSION_EXTEND_TIME || "3600") * 1000;
//     const newExpiry = Date.now() + req.session.cookie.maxAge;
//     req.session.expiry = newExpiry;
//     res.json({ message: "Session extended", sessionExpiry: newExpiry });
//     return;
//   }
//   authLog.error(`❌ Extend session failed. No authenticated user.`);
//   res.status(401).json({ message: "Not authenticated." });
// });

router.post("/logout", (req, res) => {
  const email = req.session.user;
  const ip = req.ip;
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Failed to logout." });
    authLog.info(
      { event: "auth.logout", email: maskEmail(email as string), ip },
      "User logged out",
    );
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out." });
  });
});
