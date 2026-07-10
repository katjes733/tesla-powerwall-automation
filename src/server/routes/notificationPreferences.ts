import express from "express";
import type { Request } from "express";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  isWithinSiteScope,
} from "~/server/middleware/requirePermission";
import { validateBody } from "~/server/middleware/validateBody";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity } from "~/server/types/common";
import type { IUser } from "~/server/database/models/user";
import {
  NotificationPreferencesDataSchema,
  NOTIFICATION_TYPE_SCOPE,
  resolveNotificationPreferences,
  type NotificationPreferencesData,
  type NotificationRole,
  type NotificationType,
} from "~/shared/schemas/notificationPreferences";

const apiLog = logger.child({ service: "api" });

export const router = express.Router();
router.use(resolveActorMiddleware);

// This route only ever runs behind a real session (resolveActorMiddleware
// resolves req.actor from req.session.user), so `source` is always "owner" or
// "delegate" here — "system" is only ever produced for cron/internal calls
// via runAsSystemScheduler, never for an HTTP request. Falling back to
// "delegate" (the more conservative, opted-out-by-default role) is just a
// defensive fallback for that unreachable case, not expected behavior.
function actorRole(req: Request): NotificationRole {
  return req.actor!.source === "owner" ? "owner" : "delegate";
}

router.get(
  "/",
  requirePermission("notificationPreferences.access"),
  async (req, res, next) => {
    try {
      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<IBasicEntity & IUser>("User");
      const row = await repo.findOne({
        where: { email: req.actor!.loginEmail },
        select: ["user_details"],
      });
      const stored = row?.user_details?.notification_preferences ?? null;
      res.json({
        success: true,
        data: resolveNotificationPreferences(stored, actorRole(req)),
      });
    } catch (error) {
      apiLog.error({ err: error }, "Error fetching notification preferences");
      next(error);
    }
  },
);

router.patch(
  "/",
  requirePermission("notificationPreferences.access"),
  validateBody(NotificationPreferencesDataSchema),
  async (req, res, next) => {
    const patch = req.body as NotificationPreferencesData;
    // Site-scope authorization is inline (not requireSiteScope, which only
    // guards one named body field) so it naturally covers every type present
    // in the request — account-wide types are skipped since opting into them
    // isn't a site-access concern.
    for (const [type, value] of Object.entries(patch) as [
      NotificationType,
      string[] | "*",
    ][]) {
      if (NOTIFICATION_TYPE_SCOPE[type] !== "site") continue;
      if (
        !isWithinSiteScope(value === "*" ? ["*"] : value, req.actor!.siteIds)
      ) {
        res.status(403).json({
          success: false,
          message: `Not authorized for site(s) in ${type}`,
        });
        return;
      }
    }
    try {
      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<IBasicEntity & IUser>("User");
      const existing = await repo.findOne({
        where: { email: req.actor!.loginEmail },
      });
      const now = new Date();
      const mergedDetails = {
        ...existing?.user_details,
        notification_preferences: {
          ...existing?.user_details?.notification_preferences,
          ...patch,
        },
      };
      if (existing) {
        await repo.update(existing.id, {
          modified_time: now,
          user_details: mergedDetails,
        });
      } else {
        // Every authenticated actor already has a users row by the time they
        // can reach this permission-gated route (see resolveActor.ts) — this
        // branch only guards against that invariant somehow not holding.
        await repo.save({
          email: req.actor!.loginEmail,
          password_hash: "",
          user_details: mergedDetails,
          creation_time: now,
          modified_time: now,
        });
      }
      const updated = await repo.findOne({
        where: { email: req.actor!.loginEmail },
        select: ["user_details"],
      });
      res.json({
        success: true,
        data: resolveNotificationPreferences(
          updated?.user_details?.notification_preferences ?? null,
          actorRole(req),
        ),
      });
    } catch (error) {
      apiLog.error({ err: error }, "Error updating notification preferences");
      next(error);
    }
  },
);
