import express from "express";
import { validate as validateCron } from "node-cron";
import { Scheduler } from "~/server/util/scheduler";
import AppDataSource from "../database/datasource";
import { requireAuth } from "~/server/middleware/auth";
import { ALLOWED_ACTIONS } from "~/server/util/fleet";

export const router = express.Router();

router.use(requireAuth);

router.post("/initialize", function (_req, res) {
  Scheduler.getInstance()
    .initialize()
    .then(() => {
      res.json({
        success: true,
        message: "Scheduler initialized successfully",
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error initializing scheduler",
        error: error.message,
      });
    });
});

router.post("/stop-all", function (_req, res) {
  Scheduler.getInstance()
    .stopAll()
    .then(() => {
      res.json({
        success: true,
        message: "All scheduled tasks stopped successfully",
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error stopping all scheduled tasks",
        error: error.message,
      });
    });
});

router.post("/start-all", function (_req, res) {
  Scheduler.getInstance()
    .startAll()
    .then(() => {
      res.json({
        success: true,
        message: "All scheduled tasks started successfully",
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error starting all scheduled tasks",
        error: error.message,
      });
    });
});

router.post("/upsert", function (req, res) {
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
      res.status(400).json({ success: false, message: "timezone is required" });
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
      (a: any) => !a?.action || !ALLOWED_ACTIONS.has(a.action),
    );
    if (hasInvalidAction) {
      res.status(400).json({
        success: false,
        message: "actions contain an invalid action name",
      });
      return;
    }
  }

  const scheduleData = { ...req.body, email: req.session.user as string };
  Scheduler.getInstance()
    .upsert(scheduleData)
    .then((result) => {
      res.status(result?.status || 200).json({
        success: true,
        message: "Schedule upserted successfully",
        data: result?.data,
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error upserting schedule",
        error: error.message,
      });
    });
});

router.post("/delete", function (req, res) {
  const { id } = req.body;
  Scheduler.getInstance()
    .delete(id)
    .then((result) => {
      res.status(result?.status || 204).json({
        success: true,
        message: "Schedule deleted successfully",
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error deleting schedule",
        error: error.message,
      });
    });
});

router.get("/all", async function (req, res) {
  const PAGE_SIZE_MAX = 100;
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt((req.query.pageSize as string) || "100", 10)),
  );

  const repo = (await AppDataSource.getInstance()).getRepository("Schedule");
  const email = req.session.user as string;
  repo
    .findAndCount({
      where: { email },
      take: pageSize,
      skip: (page - 1) * pageSize,
    })
    .then(([schedules, total]) => {
      res.json({
        success: true,
        data: schedules,
        total,
        page,
        pageSize,
      });
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        message: "Error retrieving schedules",
        error: error.message,
      });
    });
});
