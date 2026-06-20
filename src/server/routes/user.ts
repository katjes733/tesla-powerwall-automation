import express from "express";
import argon2 from "argon2";
import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import { requireAuth } from "~/server/middleware/auth";
import { encrypt } from "~/server/util/tokenCrypto";

export const router = express.Router();

router.post("/upsert", async (req, res) => {
  const {
    email,
    password,
    user_details,
    user_permissions,
    refresh_token,
    expires_at,
  } = req.body;
  if (!email) {
    res.status(500).json({ error: "No email specified" });
    return;
  }
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
    const userRepo = (await AppDataSource.getInstance()).getRepository("User");
    const existingUser = await userRepo.findOneBy({ email });
    const id = existingUser ? existingUser.id : v4();
    const newDate = new Date();
    let status;
    if (!existingUser) {
      userRepo.insert({
        id,
        creation_time: newDate,
        modified_time: newDate,
        email,
        password_hash: await argon2.hash(password),
        user_details: user_details ?? {},
        user_permissions: user_permissions ?? {},
      });
      status = 200;
    } else {
      // Only include provided fields in the update
      const updateFields: Record<string, any> = { modified_time: newDate };
      if (password !== undefined)
        updateFields.password_hash = await argon2.hash(password);
      if (user_details !== undefined) updateFields.user_details = user_details;
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
    logger.error(`❌ ${error.message}.`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/remove", requireAuth, async (req, res) => {
  const email = req.session.user as string;
  try {
    const userRepo = (await AppDataSource.getInstance()).getRepository("User");
    await userRepo.delete({ email });
    res.status(200).json({ email, action: "delete" });
  } catch (error: any) {
    logger.error(`❌ ${error.message}.`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
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
    res.status(400).json({ error: "Incorrect current password" });
    return;
  }

  try {
    await userRepo.update(existingUser.id, {
      modified_time: new Date(),
      password_hash: await argon2.hash(newPassword),
    });
    res.status(200).json({ email, action: "update" });
  } catch (error: any) {
    logger.error(`❌ ${error.message}.`);
    res.status(500).json({ error: error.message });
  }
});
