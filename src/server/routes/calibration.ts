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
import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import {
  CalibrationStartSchema,
  CalibrationClearSchema,
  CurveStartSchema,
} from "~/shared/schemas/calibration";
import {
  parseTariffContent,
  hasTouData,
  isCurrentlyInPeak,
} from "~/server/util/tariff";
import { redis } from "~/server/util/redis";
import {
  buildChargeCurveBins,
  meetsQualityThreshold,
  MAX_CURVE_START_SOC_PERCENT,
  type ChargeCurveCalibrationData,
} from "~/server/util/curveFit";

const MAX_GRID_RATE_SOC_PERCENT = 80;
const MAX_CURVE_CALIBRATION_SOC_PERCENT = MAX_CURVE_START_SOC_PERCENT;
const MAX_SOLAR_KW = 0.1;
const STABILITY_POLL_INTERVAL_MS = 15 * 1000;
const STABILITY_WINDOW = 4;
const STABILITY_TOLERANCE_PERCENT = 5;
const STABILITY_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_DURATION_MS = 3 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 15 * 1000;
const JOB_TTL_MS = 30 * 60 * 1000;
const CALIBRATION_TYPE = "grid_charge_rate";

const CURVE_CALIBRATION_TYPE = "chargeCurve";
const CURVE_JOB_TTL_MS = 4 * 60 * 60 * 1000;
const CURVE_SAMPLE_INTERVAL_MS = 15 * 1000;
const CURVE_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

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

interface CurveCalibrationJob {
  status: "running" | "complete" | "interrupted" | "failed";
  phase: "charging" | "done";
  startSoc: number;
  currentSoc: number;
  sampleCount: number;
  interruptRequested: boolean;
  startedAt: number; // performance.now()
  error?: string;
}

interface CurveCalibrationRedisPayload {
  jobId: string;
  email: string;
  energySiteId: string;
  productSiteId: string; // product.id — used as curveJobBySite key
  previousGridState: "enabled" | "disabled";
  startSoc: number;
  startedAtMs: number; // Date.now()
}

const curveJobs = new Map<string, CurveCalibrationJob>(); // jobId → job
const curveJobBySite = new Map<string, string>(); // product.id → jobId

function curveRedisKey(energySiteId: string): string {
  return `curve_calibration_${energySiteId}`;
}

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
    const [calibration, curveCalibration] = await Promise.all([
      repo.findOne({
        where: {
          email,
          site_id: energySiteId,
          calibration_type: CALIBRATION_TYPE,
        },
        order: { creation_time: "DESC" },
      }),
      repo.findOne({
        where: {
          email,
          site_id: energySiteId,
          calibration_type: CURVE_CALIBRATION_TYPE,
        },
        order: { creation_time: "DESC" },
      }),
    ]);
    const tariff = parseTariffContent(siteInfo?.tariff_content);
    const timezone = siteInfo?.installation_time_zone ?? "UTC";
    const now = moment().tz(timezone);
    const offPeakOk = !hasTouData(tariff) || !isCurrentlyInPeak(tariff!, now);
    const safeguards = liveStatus
      ? {
          socOkGridRate:
            liveStatus.percentage_charged < MAX_GRID_RATE_SOC_PERCENT,
          socOkCurve:
            liveStatus.percentage_charged < MAX_CURVE_CALIBRATION_SOC_PERCENT,
          solarOk: liveStatus.solar_power / 1000 < MAX_SOLAR_KW,
          onGrid: liveStatus.island_status !== "island_mode",
          offPeakOk,
          socThresholdGridRate: MAX_GRID_RATE_SOC_PERCENT,
          socThresholdCurve: MAX_CURVE_CALIBRATION_SOC_PERCENT,
          socValue: Math.round(liveStatus.percentage_charged * 10) / 10,
          solarKw: Math.round(liveStatus.solar_power / 10) / 100,
          batteryKw: Math.round(liveStatus.battery_power / 10) / 100,
          gridKw: Math.round(liveStatus.grid_power / 10) / 100,
        }
      : null;
    res.json({
      success: true,
      data: { calibration, curveCalibration, safeguards },
    });
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

      const socOk = liveStatus.percentage_charged < MAX_GRID_RATE_SOC_PERCENT;
      const solarOk = liveStatus.solar_power / 1000 < MAX_SOLAR_KW;
      const onGrid = liveStatus.island_status !== "island_mode";
      if (!socOk || !solarOk || !onGrid || !offPeakOk) {
        const failed = [
          !socOk &&
            `SOC must be below ${MAX_GRID_RATE_SOC_PERCENT}% (currently ${liveStatus.percentage_charged.toFixed(1)}%)`,
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

router.delete(
  "/curve-clear",
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
        calibration_type: CURVE_CALIBRATION_TYPE,
      });

      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, "Error clearing curve calibration data");
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Curve calibration helpers
// ---------------------------------------------------------------------------

async function finalizeCurveCalibration(
  email: string,
  energySiteId: string,
  jobStartedAtMs: number,
): Promise<void> {
  const db = await AppDataSource.getInstance(true);
  const sampleRepo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
    "SiteCalibrationSample",
  );
  const calibRepo = db.getRepository<ISiteCalibration & IBasicEntity>(
    "SiteCalibration",
  );

  const since = new Date(jobStartedAtMs);
  const sessionSamples = (await (sampleRepo as any).find({
    where: {
      site_id: energySiteId,
      email,
      calibration_type: CURVE_CALIBRATION_TYPE,
    },
    order: { creation_time: "ASC" },
  })) as Array<IBasicEntity & ISiteCalibrationSample>;
  const recentSamples = sessionSamples.filter(
    (s) => new Date(s.creation_time as unknown as string) >= since,
  );

  const candidate = buildChargeCurveBins(recentSamples);
  const existing = await calibRepo.findOne({
    where: { site_id: energySiteId, calibration_type: CURVE_CALIBRATION_TYPE },
    order: { creation_time: "DESC" },
  });
  const existingData = existing
    ? (existing.calibration_data as unknown as ChargeCurveCalibrationData)
    : null;

  if (meetsQualityThreshold(candidate, existingData)) {
    const now = new Date();
    await calibRepo.save({
      email,
      site_id: energySiteId,
      calibration_type: CURVE_CALIBRATION_TYPE,
      calibration_data: candidate as unknown as Record<string, unknown>,
      creation_time: now,
      modified_time: now,
    });
    logger.info(
      {
        energySiteId,
        bins: candidate!.bins.length,
        samples: candidate!.total_sample_count,
      },
      "Curve calibration written to site_calibrations",
    );
  } else {
    logger.info(
      { energySiteId, candidateBins: candidate?.bins.length ?? 0 },
      "Curve calibration session did not meet quality threshold — not written",
    );
  }
}

async function runCurveCalibration(
  email: string,
  fleet: Fleet,
  product: Product,
  jobId: string,
  previousGridState: "enabled" | "disabled",
  startedAtMs: number,
): Promise<void> {
  const job = curveJobs.get(jobId);
  if (!job) return;
  const energySiteId = String(product.energy_site_id);
  const db = await AppDataSource.getInstance(true);
  const sampleRepo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
    "SiteCalibrationSample",
  );
  const deadline = performance.now() + CURVE_MAX_DURATION_MS;

  try {
    while (true) {
      if (job.interruptRequested) break;
      if (performance.now() > deadline) break;

      await sleep(CURVE_SAMPLE_INTERVAL_MS);

      if (job.interruptRequested) break;

      const live = await fleet.getLiveStatus(product);
      if (!live) continue;

      job.currentSoc = live.percentage_charged;

      if (live.battery_power < -500) {
        const now = new Date();
        await sampleRepo.save({
          email,
          site_id: energySiteId,
          calibration_type: CURVE_CALIBRATION_TYPE,
          creation_time: now,
          modified_time: now,
          sample_data: {
            soc_percent: Math.round(live.percentage_charged * 100) / 100,
            battery_kw: Math.round(Math.abs(live.battery_power) / 10) / 100,
            solar_kw: Math.round(live.solar_power / 10) / 100,
            grid_kw: Math.round(live.grid_power / 10) / 100,
          },
        } as IBasicEntity & ISiteCalibrationSample);
        job.sampleCount++;
      }

      if (live.percentage_charged >= 99.5) break;
    }

    job.status = job.interruptRequested ? "interrupted" : "complete";
  } catch (err: any) {
    job.status = "failed";
    job.error = err?.message ?? "Unknown error";
    logger.error(err, "Curve calibration job failed");
  } finally {
    job.phase = "done";
    curveJobBySite.delete(product.id);

    await fleet
      .setGridCharging(product, previousGridState)
      .catch((err: any) =>
        logger.error(
          err,
          "Failed to restore grid charging after curve calibration",
        ),
      );

    try {
      await redis.del(curveRedisKey(energySiteId));
    } catch {
      // non-fatal
    }

    await finalizeCurveCalibration(email, energySiteId, startedAtMs).catch(
      (err: any) => logger.error(err, "Failed to finalize curve calibration"),
    );
  }
}

// ---------------------------------------------------------------------------
// Curve calibration routes
// ---------------------------------------------------------------------------

router.post(
  "/curve-start",
  validateBody(CurveStartSchema),
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
      const energySiteId = String(product.energy_site_id);

      if (curveJobBySite.has(siteId)) {
        res.status(409).json({
          success: false,
          message: "Curve calibration already running for this site",
        });
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
      const socOk =
        liveStatus.percentage_charged < MAX_CURVE_CALIBRATION_SOC_PERCENT;
      const onGrid = liveStatus.island_status !== "island_mode";

      if (!socOk || !onGrid || !offPeakOk) {
        const failed = [
          !socOk &&
            `SOC must be below ${MAX_CURVE_CALIBRATION_SOC_PERCENT}% (currently ${liveStatus.percentage_charged.toFixed(1)}%)`,
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
      const startedAtMs = Date.now();
      const job: CurveCalibrationJob = {
        status: "running",
        phase: "charging",
        startSoc: liveStatus.percentage_charged,
        currentSoc: liveStatus.percentage_charged,
        sampleCount: 0,
        interruptRequested: false,
        startedAt: performance.now(),
      };
      curveJobs.set(jobId, job);
      curveJobBySite.set(siteId, jobId);

      const redisPayload: CurveCalibrationRedisPayload = {
        jobId,
        email,
        energySiteId,
        productSiteId: siteId,
        previousGridState,
        startSoc: liveStatus.percentage_charged,
        startedAtMs,
      };
      try {
        await redis.setex(
          curveRedisKey(energySiteId),
          CURVE_JOB_TTL_MS / 1000,
          JSON.stringify(redisPayload),
        );
      } catch {
        // non-fatal — in-memory job still runs; restart recovery won't be available
      }

      res.json({ success: true, data: { jobId } });

      runCurveCalibration(
        email,
        fleet,
        product,
        jobId,
        previousGridState,
        startedAtMs,
      ).catch((err) =>
        logger.error(
          err,
          "Unexpected error in curve calibration background job",
        ),
      );
    } catch (error: any) {
      logger.error(error, "Error starting curve calibration");
      next(error);
    }
  },
);

router.get("/curve-job", (req, res) => {
  const siteId = req.query.siteId as string | undefined;
  if (!siteId) {
    res
      .status(400)
      .json({ success: false, message: "siteId query parameter required" });
    return;
  }

  const jobId = curveJobBySite.get(siteId);
  if (!jobId) {
    res.status(404).json({
      success: false,
      message: "No active curve calibration for this site",
    });
    return;
  }

  const job = curveJobs.get(jobId);
  if (!job) {
    res.status(404).json({ success: false, message: "Job not found" });
    return;
  }

  const elapsed = performance.now() - job.startedAt;
  if (elapsed > CURVE_JOB_TTL_MS) {
    curveJobs.delete(jobId);
    curveJobBySite.delete(siteId);
    res.status(404).json({ success: false, message: "Job expired" });
    return;
  }

  res.json({
    success: true,
    data: {
      status: job.status,
      phase: job.phase,
      startSoc: job.startSoc,
      currentSoc: job.currentSoc,
      sampleCount: job.sampleCount,
      error: job.error,
    },
  });
});

router.delete("/curve-stop", async (req, res) => {
  const siteId = req.query.siteId as string | undefined;
  if (!siteId) {
    res
      .status(400)
      .json({ success: false, message: "siteId query parameter required" });
    return;
  }
  const jobId = curveJobBySite.get(siteId);
  if (!jobId) {
    res.status(404).json({
      success: false,
      message: "No active curve calibration for this site",
    });
    return;
  }
  const job = curveJobs.get(jobId);
  if (!job) {
    res.status(404).json({ success: false, message: "Job not found" });
    return;
  }
  job.interruptRequested = true;
  res.json({ success: true });
});

router.get("/curve-status", async (req, res, next) => {
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
    const db = await AppDataSource.getInstance();
    const repo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
      "SiteCalibrationSample",
    );

    // TypeORM doesn't distribute FindOptionsOrder over intersection types;
    // cast around it and re-annotate the result.
    const samples = (await (repo as any).find({
      where: { email, site_id: energySiteId },
      order: { creation_time: "ASC" },
    })) as Array<IBasicEntity & ISiteCalibrationSample>;

    if (samples.length === 0) {
      res.json({
        success: true,
        data: {
          sampleCount: 0,
          minSoc: null,
          maxSoc: null,
          oldestDate: null,
          newestDate: null,
          socBinCount: 0,
        },
      });
      return;
    }

    const socs = samples.map((s) => Number(s.sample_data.soc_percent));
    const minSoc = Math.min(...socs);
    const maxSoc = Math.max(...socs);

    const buckets = new Map<number, number>();
    for (const s of samples) {
      const b = Math.floor(Number(s.sample_data.soc_percent));
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const socBinCount = [...buckets.values()].filter((c) => c >= 3).length;

    res.json({
      success: true,
      data: {
        sampleCount: samples.length,
        minSoc,
        maxSoc,
        oldestDate: samples[0].creation_time,
        newestDate: samples[samples.length - 1].creation_time,
        socBinCount,
      },
    });
  } catch (error: any) {
    logger.error(error, "Error fetching curve status");
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Server-restart recovery for in-progress curve calibrations
// ---------------------------------------------------------------------------

export async function recoverCurveCalibrations(): Promise<void> {
  try {
    const keys = await redis.keys("curve_calibration_*");
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (!raw) continue;
        const payload = JSON.parse(raw) as CurveCalibrationRedisPayload;
        const ageMs = Date.now() - payload.startedAtMs;
        if (ageMs > CURVE_JOB_TTL_MS) {
          await redis.del(key);
          logger.warn(
            { key },
            "Curve calibration Redis key expired — deleted without recovery",
          );
          continue;
        }

        const fleet = Fleet.getInstance(payload.email, {
          throwOnError: false,
          mailOnError: false,
        });
        const products = await fleet.getEnergyProducts();
        const product = products.find(
          (p) => String(p.energy_site_id) === payload.energySiteId,
        );
        if (!product) {
          await redis.del(key);
          logger.warn(
            { energySiteId: payload.energySiteId },
            "Curve calibration recovery: site not found — restoring grid charging defensively",
          );
          continue;
        }

        const liveStatus = await fleet.getLiveStatus(product);
        const job: CurveCalibrationJob = {
          status: "running",
          phase: "charging",
          startSoc: payload.startSoc,
          currentSoc: liveStatus?.percentage_charged ?? payload.startSoc,
          sampleCount: 0,
          interruptRequested: false,
          startedAt: performance.now() - ageMs,
        };
        curveJobs.set(payload.jobId, job);
        curveJobBySite.set(payload.productSiteId, payload.jobId);

        if (liveStatus && liveStatus.percentage_charged >= 99.5) {
          job.status = "complete";
          job.phase = "done";
          curveJobBySite.delete(payload.productSiteId);
          await fleet
            .setGridCharging(product, payload.previousGridState)
            .catch(() => {});
          await redis.del(key);
          await finalizeCurveCalibration(
            payload.email,
            payload.energySiteId,
            payload.startedAtMs,
          ).catch(() => {});
          logger.info(
            { energySiteId: payload.energySiteId },
            "Curve calibration recovered: SOC already complete, finalized",
          );
        } else {
          logger.info(
            { energySiteId: payload.energySiteId, jobId: payload.jobId },
            "Curve calibration recovered: resuming background job",
          );
          runCurveCalibration(
            payload.email,
            fleet,
            product,
            payload.jobId,
            payload.previousGridState,
            payload.startedAtMs,
          ).catch((err) =>
            logger.error(err, "Error in recovered curve calibration job"),
          );
        }
      } catch (err: any) {
        logger.error(err, `Curve calibration recovery failed for key ${key}`);
      }
    }
  } catch {
    // Redis unavailable at startup — non-fatal
  }
}
