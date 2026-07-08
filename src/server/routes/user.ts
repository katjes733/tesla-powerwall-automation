import express from "express";
import argon2 from "argon2";
import AppDataSource from "~/server/database/datasource";
import { requireAuth } from "~/server/middleware/auth";
import { encrypt } from "~/server/util/tokenCrypto";
import { maskEmail } from "~/server/util/maskEmail";
import { validateBody } from "~/server/middleware/validateBody";
import { UserUpsertSchema, ChangePasswordSchema } from "~/shared/schemas/user";
import { storePendingSignup } from "~/server/util/pendingSignup";

const authLog = logger.child({ service: "auth" });

export const router = express.Router();

router.post(
  "/upsert",
  validateBody(UserUpsertSchema),
  async (req, res, next) => {
    const {
      email,
      password,
      user_details,
      user_permissions,
      refresh_token,
      expires_at,
    } = req.body;
    if (
      !password &&
      !user_details &&
      !user_permissions &&
      !refresh_token &&
      !expires_at
    ) {
      res.status(200).send();
      return;
    }
    try {
      const userRepo = (await AppDataSource.getInstance()).getRepository(
        "User",
      );
      const existingUser = await userRepo.findOneBy({ email });
      const newDate = new Date();
      let status;
      if (!existingUser) {
        // No placeholder row => a genuine new self-signup, not a delegate
        // completing an invite (invited delegates already have a placeholder
        // row created by userAdmin.ts's invite handler before they ever reach
        // here). Held in Redis with a TTL instead of Postgres — materialized
        // into a real users row only once Tesla OAuth completes (see
        // main.ts's /callback handler); an abandoned signup that never links
        // just expires on its own, no cleanup job needed.
        await storePendingSignup(email, {
          passwordHash: await argon2.hash(password),
          userDetails: user_details ?? {},
          userPermissions: user_permissions ?? {},
        });
        status = 200;
        authLog.info(
          {
            event: "auth.account.pending",
            email: maskEmail(email),
            ip: req.ip,
          },
          "Pending signup stored (awaiting Tesla OAuth)",
        );
      } else {
        // Only include provided fields in the update
        const updateFields: Record<string, any> = { modified_time: newDate };
        if (password !== undefined)
          updateFields.password_hash = await argon2.hash(password);
        if (user_details !== undefined)
          updateFields.user_details = user_details;
        if (user_permissions !== undefined)
          updateFields.user_permissions = user_permissions;
        if (refresh_token !== undefined)
          updateFields.refresh_token = encrypt(refresh_token);
        if (expires_at !== undefined) updateFields.expires_at = expires_at;

        userRepo.update(existingUser.id, updateFields);
        status = 201;
      }
      res
        .status(status)
        .json({ email, action: status === 200 ? "create" : "update" });
    } catch (error: any) {
      authLog.error(
        {
          event: "auth.account.upsert.error",
          email: maskEmail(email),
          ip: req.ip,
          err: error,
        },
        "Account upsert error",
      );
      next(error);
    }
  },
);

router.post("/remove", requireAuth, async (req, res, next) => {
  const email = req.session.user as string;
  const ip = req.ip;
  try {
    const userRepo = (await AppDataSource.getInstance()).getRepository("User");
    const userToDelete = await userRepo.findOneBy({ email });
    await userRepo.delete({ email });
    authLog.warn(
      {
        event: "auth.account.deleted",
        userId: userToDelete?.id,
        email: maskEmail(email),
        ip,
      },
      "User account deleted",
    );
    res.status(200).json({ email, action: "delete" });
  } catch (error: any) {
    authLog.error(
      {
        event: "auth.account.delete.error",
        email: maskEmail(email),
        ip,
        err: error,
      },
      "Account deletion error",
    );
    next(error);
  }
});

router.post(
  "/change-password",
  requireAuth,
  validateBody(ChangePasswordSchema),
  async (req, res, next) => {
    const email = req.session.user as string;
    const { currentPassword, newPassword } = req.body;

    const userRepo = (await AppDataSource.getInstance()).getRepository("User");
    const existingUser = await userRepo.findOneBy({ email });
    if (!existingUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const isMatch = await argon2.verify(
      existingUser.password_hash,
      currentPassword,
    );
    if (!isMatch) {
      authLog.warn(
        {
          event: "auth.password.change.failure",
          userId: existingUser.id,
          email: maskEmail(email),
          ip: req.ip,
          reason: "wrong_current_password",
        },
        "Password change failed: wrong current password",
      );
      res.status(400).json({ error: "Incorrect current password" });
      return;
    }

    try {
      await userRepo.update(existingUser.id, {
        modified_time: new Date(),
        password_hash: await argon2.hash(newPassword),
      });
      authLog.info(
        {
          event: "auth.password.changed",
          userId: existingUser.id,
          email: maskEmail(email),
          ip: req.ip,
        },
        "Password changed successfully",
      );
      res.status(200).json({ email, action: "update" });
    } catch (error: any) {
      authLog.error(
        {
          event: "auth.password.change.error",
          userId: existingUser.id,
          email: maskEmail(email),
          ip: req.ip,
          err: error,
        },
        "Password change error",
      );
      next(error);
    }
  },
);
