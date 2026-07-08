import express from "express";
import { validate as validateCron } from "node-cron";
import { Scheduler } from "~/server/util/scheduler";
import AppDataSource from "../database/datasource";
import { ALLOWED_ACTIONS } from "~/server/util/fleet";
import { CALIBRATION_SCHEDULE_ACTIONS } from "~/server/util/calibrationService";
import { validateBody } from "~/server/middleware/validateBody";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  requireSiteScope,
  isWithinSiteScope,
} from "~/server/middleware/requirePermission";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import {
  ScheduleUpsertSchema,
  ScheduleDeleteSchema,
} from "~/shared/schemas/schedule";

export const router = express.Router();

router.use(resolveActorMiddleware);

// /initialize, /stop-all, /start-all were removed: they control the single
// process-wide cron scheduler for every Tesla account on this instance, not one
// account, so no per-account permission is the right trust boundary for them.
// They had zero real usage anywhere (no UI, no tests, no scripts) — initialize()
// already runs automatically at server boot via a direct method call in main.ts,
// which is unaffected by this removal.

router.post(
  "/upsert",
  requirePermission("schedule.edit"),
  requireSiteScope({ bodyKey: "site_ids" }),
  validateBody(ScheduleUpsertSchema),
  function (req, res, next) {
    const { id, cron, timezone, site_ids, actions } = req.body;

    if (cron !== undefined && !validateCron(cron)) {
      res
        .status(400)
        .json({ success: false, message: "Invalid cron expression" });
      return;
    }

    if (!id) {
      if (!cron) {
        res.status(400).json({ success: false, message: "cron is required" });
        return;
      }
      if (!timezone || typeof timezone !== "string") {
        res
          .status(400)
          .json({ success: false, message: "timezone is required" });
        return;
      }
      if (!Array.isArray(site_ids) || site_ids.length === 0) {
        res.status(400).json({
          success: false,
          message: "site_ids must be a non-empty array",
        });
        return;
      }
    }

    if (Array.isArray(actions)) {
      const hasInvalidAction = actions.some(
        (a: any) =>
          !a?.action ||
          (!ALLOWED_ACTIONS.has(a.action) &&
            !CALIBRATION_SCHEDULE_ACTIONS.has(a.action)),
      );
      if (hasInvalidAction) {
        res.status(400).json({
          success: false,
          message: "actions contain an invalid action name",
        });
        return;
      }
    }

    const scheduleData = {
      ...req.body,
      email: getCurrentAccountEmail(req) as string,
    };
    Scheduler.getInstance()
      .upsert(scheduleData)
      .then((result) => {
        res.status(result?.status || 200).json({
          success: true,
          message: "Schedule upserted successfully",
          data: result?.data,
        });
      })
      .catch(next);
  },
);

router.post(
  "/delete",
  requirePermission("schedule.delete"),
  validateBody(ScheduleDeleteSchema),
  async function (req, res, next) {
    const { id } = req.body;
    const actor = req.actor!;
    try {
      const repo = (await AppDataSource.getInstance()).getRepository(
        "Schedule",
      );
      const schedule = await repo.findOneBy({ id });
      if (!schedule || schedule.email !== actor.accountEmail) {
        res.status(404).json({ success: false, message: "Schedule not found" });
        return;
      }
      if (
        actor.siteIds !== "*" &&
        !(schedule.site_ids as string[]).every((siteId) =>
          (actor.siteIds as string[]).includes(siteId),
        )
      ) {
        res.status(403).json({
          success: false,
          message: "Not authorized for this schedule's site(s)",
        });
        return;
      }
      const result = await Scheduler.getInstance().delete(id);
      res.status(result?.status || 204).json({
        success: true,
        message: "Schedule deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/all",
  requirePermission("schedule.access"),
  async function (req, res, next) {
    const PAGE_SIZE_MAX = 100;
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt((req.query.pageSize as string) || "100", 10)),
    );

    const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
    const email = getCurrentAccountEmail(req) as string;
    const actor = req.actor!;

    if (actor.siteIds === "*") {
      repo
        .findAndCount({
          where: { email },
          take: pageSize,
          skip: (page - 1) * pageSize,
        })
        .then(([schedules, total]) => {
          res.json({ success: true, data: schedules, total, page, pageSize });
        })
        .catch(next);
      return;
    }

    // A site-scoped delegate's visible set depends on each schedule's own
    // site_ids (jsonb, not a simple column filter) — paginate in memory over
    // the account's full schedule list rather than push a jsonb containment
    // query into the DB layer for what's realistically a small list.
    repo
      .findBy({ email })
      .then((all) => {
        const visible = all.filter((s) =>
          isWithinSiteScope(s.site_ids as string[], actor.siteIds),
        );
        const total = visible.length;
        const start = (page - 1) * pageSize;
        res.json({
          success: true,
          data: visible.slice(start, start + pageSize),
          total,
          page,
          pageSize,
        });
      })
      .catch(next);
  },
);
