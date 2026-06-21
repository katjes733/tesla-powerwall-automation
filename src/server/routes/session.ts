import express, { Router } from "express";
import argon2 from "argon2";
import AppDataSource from "~/server/database/datasource";
import type { IUser } from "~/server/database/models/user";
import { loginLimiter } from "~/server/middleware/rateLimiter";

// Extend express-session types to include 'expiry'
declare module "express-session" {
  // eslint-disable-next-line no-unused-vars
  interface SessionData {
    expiry?: number;
    user?: any;
  }
}

export const router: Router = express.Router();

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;
  if (!email) {
    logger.warn(
      { event: "auth.login.failure", ip, reason: "missing_email" },
      "Login attempt with no email",
    );
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  logger.info({ event: "auth.login.attempt", email, ip }, "Login attempt");
  try {
    const dataSource = await AppDataSource.getInstance();
    const userRepo = dataSource.getRepository<IUser>("User");
    const user = await userRepo.findOneBy({ email });
    if (!user) {
      logger.warn(
        { event: "auth.login.failure", email, ip, reason: "user_not_found" },
        "Login failed: user not found",
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValid = await argon2.verify(user.password_hash, password);
    if (!isValid) {
      logger.warn(
        { event: "auth.login.failure", email, ip, reason: "invalid_password" },
        "Login failed: invalid password",
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (
      user.user_permissions?.type &&
      !["user", "admin"].includes(user.user_permissions?.type)
    ) {
      logger.warn(
        {
          event: "auth.login.failure",
          email,
          ip,
          reason: "unknown_permission_type",
        },
        "Login failed: unknown permission type",
      );
      res.status(403).json({ error: "Unknown permission type" });
      return;
    }

    req.session.user = user.email;
    if (!req.session.expiry) {
      req.session.expiry = Date.now() + (req.session.cookie.maxAge || 3600000);
    }
    logger.info({ event: "auth.login.success", email, ip }, "Login successful");
    res.json({
      message: "Logged in",
      user: req.session.user,
      sessionExpiry: req.session.expiry,
    });
    return;
  } catch (error: any) {
    logger.error(
      { event: "auth.login.error", email, ip, err: error },
      "Login error",
    );
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", (req, res) => {
  if (req.session?.user) {
    res.json({
      user: req.session.user,
      sessionExpiry: req.session.expiry,
    });
    return;
  }
  logger.debug(`❌ Identification failed. No authenticated user.`);
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
//   logger.error(`❌ Extend session failed. No authenticated user.`);
//   res.status(401).json({ message: "Not authenticated." });
// });

router.post("/logout", (req, res) => {
  const email = req.session.user;
  const ip = req.ip;
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Failed to logout." });
    logger.info({ event: "auth.logout", email, ip }, "User logged out");
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out." });
  });
});
