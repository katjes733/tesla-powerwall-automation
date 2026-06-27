import express from "express";
import moment from "moment-timezone";
import { v4 as uuidv4 } from "uuid";
import { Fleet } from "~/server/util/fleet";
import { requireAuth } from "~/server/middleware/auth";
import { validateBody } from "~/server/middleware/validateBody";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity, Product } from "~/server/types/common";
import type {
  ISiteCalibration,
  IGridChargeRateCalibrationData,
} from "~/server/database/models/siteCalibration";
import {
  CalibrationStartSchema,
  CalibrationClearSchema,
} from "~/shared/schemas/calibration";
import {
  parseTariffContent,
  hasTouData,
  isCurrentlyInPeak,
} from "~/server/util/tariff";

const MAX_CALIBRATION_SOC_PERCENT = 80;
const MAX_SOLAR_KW = 0.1;
const STABILITY_POLL_INTERVAL_MS = 15 * 1000;
const STABILITY_WINDOW = 4;
const STABILITY_TOLERANCE_PERCENT = 5;
const STABILITY_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_DURATION_MS = 3 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 15 * 1000;
const JOB_TTL_MS = 30 * 60 * 1000;
const CALIBRATION_TYPE = "grid_charge_rate";

type CalibrationPhase = "ramp-up" | "sampling" | "done";
type CalibrationJobStatus = "running" | "complete" | "failed";

interface CalibrationJob {
  status: CalibrationJobStatus;
  phase: CalibrationPhase;
  startedAt: number;
  error?: string;
  result?: ISiteCalibration & IBasicEntity;
}

const calibrationJobs = new Map<string, CalibrationJob>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  const email = req.session.user!;
  const siteId = req.query.siteId as string | undefined;
  if (!siteId) {
    res
      .status(400)
      .json({ success: false, message: "siteId query parameter required" });
    return;
  }
  try {
    const fleet = Fleet.getInstance(email, {
      throwOnError: false,
      mailOnError: false,
    });
    const products = await fleet.getEnergyProducts();
    const product = products.find((p) => p.id === siteId);
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    const energySiteId = String(product.energy_site_id);
    const [liveStatus, siteInfo, db] = await Promise.all([
      fleet.getLiveStatus(product),
      fleet.getSiteInfo(product),
      AppDataSource.getInstance(),
    ]);
    const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
      "SiteCalibration",
    );
    const calibration = await repo.findOne({
      where: {
        email,
        site_id: energySiteId,
        calibration_type: CALIBRATION_TYPE,
      },
      order: { creation_time: "DESC" },
    });
    const tariff = parseTariffContent(siteInfo?.tariff_content);
    const timezone = siteInfo?.installation_time_zone ?? "UTC";
    const now = moment().tz(timezone);
    const offPeakOk = !hasTouData(tariff) || !isCurrentlyInPeak(tariff!, now);
    const safeguards = liveStatus
      ? {
          socOk: liveStatus.percentage_charged < MAX_CALIBRATION_SOC_PERCENT,
          solarOk: liveStatus.solar_power / 1000 < MAX_SOLAR_KW,
          onGrid: liveStatus.island_status !== "island_mode",
          offPeakOk,
          socValue: Math.round(liveStatus.percentage_charged * 10) / 10,
          solarKw: Math.round(liveStatus.solar_power / 10) / 100,
          batteryKw: Math.round(liveStatus.battery_power / 10) / 100,
          gridKw: Math.round(liveStatus.grid_power / 10) / 100,
        }
      : null;
    res.json({ success: true, data: { calibration, safeguards } });
  } catch (error: any) {
    logger.error(error, "Error fetching calibration data");
    next(error);
  }
});

router.post(
  "/start",
  validateBody(CalibrationStartSchema),
  async (req, res, next) => {
    const email = req.session.user!;
    const { siteId } = req.body;
    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: true,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find((p) => p.id === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const [liveStatus, siteInfo] = await Promise.all([
        fleet.getLiveStatus(product),
        fleet.getSiteInfo(product),
      ]);
      if (!liveStatus || !siteInfo) {
        res.status(503).json({
          success: false,
          message: "Site data unavailable — try again",
        });
        return;
      }

      const tariff = parseTariffContent(siteInfo.tariff_content);
      const timezone = siteInfo.installation_time_zone ?? "UTC";
      const now = moment().tz(timezone);
      const offPeakOk = !hasTouData(tariff) || !isCurrentlyInPeak(tariff!, now);

      const socOk = liveStatus.percentage_charged < MAX_CALIBRATION_SOC_PERCENT;
      const solarOk = liveStatus.solar_power / 1000 < MAX_SOLAR_KW;
      const onGrid = liveStatus.island_status !== "island_mode";
      if (!socOk || !solarOk || !onGrid || !offPeakOk) {
        const failed = [
          !socOk &&
            `SOC must be below ${MAX_CALIBRATION_SOC_PERCENT}% (currently ${liveStatus.percentage_charged.toFixed(1)}%)`,
          !solarOk &&
            `Solar must be below ${MAX_SOLAR_KW} kW — calibrate at night (currently ${(liveStatus.solar_power / 1000).toFixed(2)} kW)`,
          !onGrid && "System must be on-grid",
          !offPeakOk && "Must be during off-peak hours",
        ].filter(Boolean);
        res.status(400).json({
          success: false,
          message: `Safeguards not met: ${failed.join("; ")}`,
        });
        return;
      }

      const previousGridState =
        siteInfo.components.disallow_charge_from_grid_with_solar_installed ===
        false
          ? "enabled"
          : "disabled";

      await fleet.setGridCharging(product, "enabled");

      const jobId = uuidv4();
      const job: CalibrationJob = {
        status: "running",
        phase: "ramp-up",
        startedAt: performance.now(),
      };
      calibrationJobs.set(jobId, job);

      res.json({ success: true, data: { jobId } });

      runCalibration(email, fleet, product, job, previousGridState).catch(
        (err) => {
          logger.error(err, "Unexpected error in calibration background job");
        },
      );
    } catch (error: any) {
      logger.error(error, "Error starting calibration");
      next(error);
    }
  },
);

async function runCalibration(
  email: string,
  fleet: Fleet,
  product: Product,
  job: CalibrationJob,
  previousGridState: "enabled" | "disabled",
): Promise<void> {
  try {
    // Phase 1: stability detection — wait for charge rate to stabilize
    const window: number[] = [];
    const deadline = performance.now() + STABILITY_TIMEOUT_MS;
    while (true) {
      if (performance.now() > deadline) {
        throw new Error(
          "Charge rate did not stabilize within 10 minutes — try again",
        );
      }
      await sleep(STABILITY_POLL_INTERVAL_MS);
      const live = await fleet.getLiveStatus(product);
      if (!live) continue;
      const batteryChargingKw =
        live.battery_power < 0 ? -live.battery_power / 1000 : 0;
      window.push(batteryChargingKw);
      if (window.length > STABILITY_WINDOW) window.shift();
      if (window.length === STABILITY_WINDOW) {
        const avg = mean(window);
        if (avg > 0) {
          const allWithin = window.every(
            (r) =>
              (Math.abs(r - avg) / avg) * 100 <= STABILITY_TOLERANCE_PERCENT,
          );
          if (allWithin) break;
        }
      }
    }

    // Phase 2: sampling
    job.phase = "sampling";
    const samples: number[] = [];
    const N = Math.round(SAMPLE_DURATION_MS / SAMPLE_INTERVAL_MS);
    let lastLive = null;
    for (let i = 0; i < N; i++) {
      await sleep(SAMPLE_INTERVAL_MS);
      const live = await fleet.getLiveStatus(product);
      if (!live) continue;
      lastLive = live;
      const batteryChargingKw =
        live.battery_power < 0 ? -live.battery_power / 1000 : 0;
      samples.push(batteryChargingKw);
    }

    if (samples.length === 0 || !lastLive) {
      throw new Error("No valid samples collected — try again");
    }

    const avgRateKw = Math.round(mean(samples) * 100) / 100;
    const calibrationData: IGridChargeRateCalibrationData = {
      kw: avgRateKw,
      soc_percent: Math.round(lastLive.percentage_charged * 10) / 10,
      solar_kw: Math.round(lastLive.solar_power / 10) / 100,
      battery_kw: Math.round(Math.abs(lastLive.battery_power) / 10) / 100,
      sample_count: samples.length,
    };

    const now = new Date();
    const db = await AppDataSource.getInstance();
    const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
      "SiteCalibration",
    );
    const saved = await repo.save({
      email,
      site_id: String(product.energy_site_id),
      calibration_type: CALIBRATION_TYPE,
      calibration_data: calibrationData as unknown as Record<string, unknown>,
      creation_time: now,
      modified_time: now,
    });

    job.status = "complete";
    job.phase = "done";
    job.result = saved;
    logger.info(
      {
        siteId: product.energy_site_id,
        kw: avgRateKw,
        sampleCount: samples.length,
      },
      "Grid charge rate calibration complete",
    );
  } catch (err: any) {
    job.status = "failed";
    job.phase = "done";
    job.error = err?.message ?? "Unknown error";
    logger.error(err, "Calibration job failed");
  } finally {
    await fleet
      .setGridCharging(product, previousGridState)
      .catch((err: any) => {
        logger.error(
          err,
          "Failed to restore grid charging state after calibration",
        );
      });
  }
}

router.get("/job", (req, res) => {
  const jobId = req.query.jobId as string | undefined;
  if (!jobId) {
    res
      .status(400)
      .json({ success: false, message: "jobId query parameter required" });
    return;
  }

  const now = performance.now();
  for (const [id, j] of calibrationJobs.entries()) {
    if (now - j.startedAt > JOB_TTL_MS) calibrationJobs.delete(id);
  }

  const job = calibrationJobs.get(jobId);
  if (!job) {
    res.status(404).json({ success: false, message: "Job not found" });
    return;
  }

  res.json({
    success: true,
    data: {
      status: job.status,
      phase: job.phase,
      result: job.result,
      error: job.error,
    },
  });
});

router.delete(
  "/clear",
  validateBody(CalibrationClearSchema),
  async (req, res, next) => {
    const email = req.session.user!;
    const { siteId } = req.body;
    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find((p) => p.id === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
        "SiteCalibration",
      );
      await repo.delete({
        email,
        site_id: String(product.energy_site_id),
        calibration_type: CALIBRATION_TYPE,
      });

      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, "Error clearing calibration data");
      next(error);
    }
  },
);
