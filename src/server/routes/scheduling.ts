import express from "express";
import { Scheduler } from "~/server/util/scheduler";

export const router = express.Router();

router.post("/initialize", function (req, res) {
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

  router.post("/stop-all", function (req, res) {
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

  router.post("/start-all", function (req, res) {
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
    const scheduleData = req.body;
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
});
