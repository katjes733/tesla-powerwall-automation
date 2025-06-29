import express from "express";
import { Scheduler } from "~/util/scheduler";

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
});
