import express from "express";
import AppDataSource from "~/database/datasource";

export const router = express.Router();

router.get("/status-server", (req, res) => {
  res.status(200).send({ status: "ok", message: "Service is healthy" });
});

router.get("/status-db", async (req, res) => {
  try {
    const ds = await AppDataSource.getInstance();
    await ds.query("SELECT 1");
    res.status(200).send({ status: "ok", message: "Database is healthy" });
  } catch (error) {
    logger.error(error, "❌ Error checking database health:");
    res
      .status(500)
      .send({ status: "error", message: "Database is not healthy" });
  }
});
