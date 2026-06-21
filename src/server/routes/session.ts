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
  if (!email) {
    logger.error(`❌ No email provided.`);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  try {
    const dataSource = await AppDataSource.getInstance();
    const userRepo = dataSource.getRepository<IUser>("User");
    const user = await userRepo.findOneBy({ email });
    if (!user) {
      logger.error(`❌ User ${email} does not exist.`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValid = await argon2.verify(user.password_hash, password);
    if (!isValid) {
      logger.error(`❌ User ${user.email} provided invalid credentials.`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (
      user.user_permissions?.type &&
      !["user", "admin"].includes(user.user_permissions?.type)
    ) {
      logger.error(`❌ User ${user.email} with unknown permission type.`);
      res.status(403).json({ error: "Unknown permission type" });
      return;
    }

    // if (
    //   !user.user_permissions?.bu ||
    //   !["im", "gb"].includes(user.user_permissions?.bu)
    // ) {
    //   logger.error(`❌ User ${user.email} is not permitted.`);
    //   res.status(403).json({ error: "Not permitted" });
    //   return;
    // }

    // const userInfo = {
    //   userid: user.id,
    //   email: user.email,
    //   type: user.user_permissions?.type || "user",
    // };
    // req.session.user = userInfo;
    req.session.user = user.email;
    if (!req.session.expiry) {
      req.session.expiry = Date.now() + (req.session.cookie.maxAge || 3600000); // Default to 1 hour if not set
    }
    res.json({
      message: "Logged in",
      user: req.session.user,
      sessionExpiry: req.session.expiry,
    });
    return;
  } catch (error: any) {
    logger.error(`❌ ${error.message}.`);
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
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Failed to logout." });
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out." });
  });
});
