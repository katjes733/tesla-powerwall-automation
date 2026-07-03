import express, { Router } from "express";
import argon2 from "argon2";
import AppDataSource from "~/server/database/datasource";
import type { IUser } from "~/server/database/models/user";
import { loginLimiter } from "~/server/middleware/rateLimiter";
import { redis } from "~/server/util/redis";
import { maskEmail } from "~/server/util/maskEmail";
import { validateBody } from "~/server/middleware/validateBody";
import { LoginSchema } from "~/shared/schemas/auth";

const LOCKOUT_MAX = 5;
const LOCKOUT_TTL = 15 * 60; // seconds

function lockoutKey(email: string) {
  return `lockout:${email}`;
}

async function isLockedOut(email: string): Promise<boolean> {
  try {
    const count = await redis.get(lockoutKey(email));
    return count !== null && parseInt(count, 10) >= LOCKOUT_MAX;
  } catch {
    return false; // fail open — don't block login if Redis is unavailable
  }
}

async function recordFailure(email: string): Promise<void> {
  try {
    const key = lockoutKey(email);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOCKOUT_TTL);
    }
  } catch {
    // Redis unavailable — skip silently
  }
}

async function clearLockout(email: string): Promise<void> {
  try {
    await redis.del(lockoutKey(email));
  } catch {
    // Redis unavailable — skip silently
  }
}

// Extend express-session types to include 'expiry'
declare module "express-session" {
  // eslint-disable-next-line no-unused-vars
  interface SessionData {
    expiry?: number;
    user?: any;
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
      if (!user) {
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

      const isValid = await argon2.verify(user.password_hash, password);
      if (!isValid) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            userId: user.id,
            email: maskEmail(email),
            ip,
            reason: "invalid_password",
          },
          "Login failed: invalid password",
        );
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (
        user.user_permissions?.type &&
        !["user", "admin"].includes(user.user_permissions?.type)
      ) {
        authLog.warn(
          {
            event: "auth.login.failure",
            userId: user.id,
            email: maskEmail(email),
            ip,
            reason: "unknown_permission_type",
          },
          "Login failed: unknown permission type",
        );
        res.status(403).json({ error: "Unknown permission type" });
        return;
      }

      await clearLockout(email);
      req.session.user = user.email;
      if (!req.session.expiry) {
        req.session.expiry =
          Date.now() + (req.session.cookie.maxAge || 3600000);
      }
      authLog.info(
        {
          event: "auth.login.success",
          userId: user.id,
          email: maskEmail(email),
          ip,
        },
        "Login successful",
      );
      res.json({
        message: "Logged in",
        user: req.session.user,
        sessionExpiry: req.session.expiry,
      });
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

router.get("/me", (req, res) => {
  if (req.session?.user) {
    res.json({
      user: req.session.user,
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
