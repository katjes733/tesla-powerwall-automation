import express from "express";
import moment from "moment-timezone";
import { v4 as uuidv4 } from "uuid";
import { Fleet } from "~/server/util/fleet";
import { requireAuth } from "~/server/middleware/auth";
import { validateBody } from "~/server/middleware/validateBody";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity } from "~/server/types/common";
import type { ISiteCalibration } from "~/server/database/models/siteCalibration";
import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import {
  CalibrationStartSchema,
  CalibrationClearSchema,
  CurveClearSchema,
  CurveStartSchema,
} from "~/shared/schemas/calibration";
import {
  parseTariffContent,
  hasTouData,
  isCurrentlyInPeak,
  isInPeakInAnySeasonAtTime,
} from "~/server/util/tariff";
import { redis } from "~/server/util/redis";
import { sendEmail } from "~/server/util/mailing";
import { buildChargeCurveBins, isValidCandidate } from "~/server/util/curveFit";
import {
  MAX_GRID_RATE_SOC_PERCENT,
  MAX_CURVE_CALIBRATION_SOC_PERCENT,
  MAX_SOLAR_KW,
  JOB_TTL_MS,
  CALIBRATION_TYPE,
  CURVE_CALIBRATION_TYPE,
  CURVE_JOB_TTL_MS,
  calibrationJobs,
  calibrationJobBySite,
  curveJobs,
  curveJobBySite,
  curveRedisKey,
  runCalibration,
  runCurveCalibration,
  finalizeCurveCalibration,
  isCalibrationRunningForSite,
  type CalibrationJob,
  type CurveCalibrationJob,
  type CurveCalibrationRedisPayload,
} from "~/server/util/calibrationService";

const calibLog = logger.child({ service: "calibration" });

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
    const product = products.find((p) => String(p.energy_site_id) === siteId);
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
          site_id: energySiteId,
          calibration_type: CALIBRATION_TYPE,
        },
        order: { creation_time: "DESC" },
      }),
      repo.findOne({
        where: {
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
          siteTimezone: timezone,
        }
      : null;
    res.json({
      success: true,
      data: { calibration, curveCalibration, safeguards },
    });
  } catch (error: any) {
    calibLog.error({ err: error }, "Error fetching calibration data");
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
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      if (isCalibrationRunningForSite(siteId)) {
        res.status(409).json({
          success: false,
          message:
            "A calibration is already running for this site — only one calibration type may run at a time",
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
        siteId,
      };
      calibrationJobs.set(jobId, job);
      calibrationJobBySite.set(siteId, jobId);

      res.json({ success: true, data: { jobId } });

      runCalibration(
        fleet,
        product,
        job,
        previousGridState,
        req.session.user!,
      ).catch((err) => {
        calibLog.error(
          { err },
          "Unexpected error in calibration background job",
        );
      });
    } catch (error: any) {
      calibLog.error({ err: error }, "Error starting calibration");
      next(error);
    }
  },
);

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
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
        "SiteCalibration",
      );
      await repo.delete({
        site_id: String(product.energy_site_id),
        calibration_type: CALIBRATION_TYPE,
      });

      res.json({ success: true });
    } catch (error: any) {
      calibLog.error({ err: error }, "Error clearing calibration data");
      next(error);
    }
  },
);

router.delete(
  "/curve-clear",
  validateBody(CurveClearSchema),
  async (req, res, next) => {
    const email = req.session.user!;
    const { siteId, mode } = req.body;
    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const energySiteId = String(product.energy_site_id);
      const db = await AppDataSource.getInstance();
      const calibRepo = db.getRepository<ISiteCalibration & IBasicEntity>(
        "SiteCalibration",
      );
      const sampleRepo = db.getRepository<
        IBasicEntity & ISiteCalibrationSample
      >("SiteCalibrationSample");

      if (mode === "all") {
        await sampleRepo.delete({
          site_id: energySiteId,
          calibration_type: CURVE_CALIBRATION_TYPE,
        });
        await calibRepo.delete({
          site_id: energySiteId,
          calibration_type: CURVE_CALIBRATION_TYPE,
        });
      } else {
        const SESSION_GAP_MS = 60 * 60 * 1000;
        const allSamples = (await (sampleRepo as any).find({
          where: {
            site_id: energySiteId,
            calibration_type: CURVE_CALIBRATION_TYPE,
          },
          order: { creation_time: "ASC" },
        })) as Array<IBasicEntity & ISiteCalibrationSample>;

        if (allSamples.length > 0) {
          let lastSessionStart = 0;
          for (let i = allSamples.length - 2; i >= 0; i--) {
            const curr = new Date(
              allSamples[i + 1].creation_time as unknown as string,
            ).getTime();
            const prev = new Date(
              allSamples[i].creation_time as unknown as string,
            ).getTime();
            if (curr - prev > SESSION_GAP_MS) {
              lastSessionStart = i + 1;
              break;
            }
          }

          await sampleRepo.remove(allSamples.slice(lastSessionStart));

          const remaining = allSamples.slice(0, lastSessionStart);
          const candidate = buildChargeCurveBins(remaining);
          if (isValidCandidate(candidate)) {
            const now = new Date();
            await calibRepo.save({
              site_id: energySiteId,
              calibration_type: CURVE_CALIBRATION_TYPE,
              calibration_data: candidate as unknown as Record<string, unknown>,
              creation_time: now,
              modified_time: now,
            });
          } else {
            await calibRepo.delete({
              site_id: energySiteId,
              calibration_type: CURVE_CALIBRATION_TYPE,
            });
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      calibLog.error({ err: error }, "Error clearing curve calibration data");
      next(error);
    }
  },
);

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
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }
      const energySiteId = String(product.energy_site_id);

      if (isCalibrationRunningForSite(siteId)) {
        res.status(409).json({
          success: false,
          message:
            "A calibration is already running for this site — only one calibration type may run at a time",
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
        // non-fatal
      }

      res.json({ success: true, data: { jobId } });

      runCurveCalibration(
        fleet,
        product,
        jobId,
        previousGridState,
        email,
      ).catch((err) =>
        calibLog.error(
          { err },
          "Unexpected error in curve calibration background job",
        ),
      );
    } catch (error: any) {
      calibLog.error({ err: error }, "Error starting curve calibration");
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
    const product = products.find((p) => String(p.energy_site_id) === siteId);
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    const energySiteId = String(product.energy_site_id);
    const db = await AppDataSource.getInstance();
    const repo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
      "SiteCalibrationSample",
    );

    const samples = (await (repo as any).find({
      where: { site_id: energySiteId },
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
    calibLog.error({ err: error }, "Error fetching curve status");
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Peak status check endpoint
// ---------------------------------------------------------------------------

router.get("/peak-status", async (req, res, next) => {
  const email = req.session.user!;
  const siteId = req.query.siteId as string | undefined;
  const timestamp = req.query.timestamp as string | undefined;
  const hourParam = req.query.hour as string | undefined;
  const minuteParam = req.query.minute as string | undefined;
  const dowParam = req.query.daysOfWeek as string | undefined;
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
    const product = products.find((p) => String(p.energy_site_id) === siteId);
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    const siteInfo = await fleet.getSiteInfo(product);
    if (!siteInfo) {
      res.json({ success: true, data: { hasTouData: false, inPeak: false } });
      return;
    }
    const tariff = parseTariffContent(siteInfo.tariff_content);
    const tariffHasData = hasTouData(tariff);
    let inPeak = false;
    if (tariffHasData && tariff) {
      if (hourParam !== undefined && minuteParam !== undefined) {
        // All-seasons check for recurring schedules.
        const hour = parseInt(hourParam, 10);
        const minute = parseInt(minuteParam, 10);
        const teslaDows = dowParam
          ? dowParam
              .split(",")
              .map(Number)
              .filter((n) => !isNaN(n))
          : [];
        inPeak = isInPeakInAnySeasonAtTime(tariff, hour, minute, teslaDows);
      } else {
        const timezone = siteInfo.installation_time_zone ?? "UTC";
        const checkMoment = timestamp
          ? moment(timestamp).tz(timezone)
          : moment().tz(timezone);
        inPeak = isCurrentlyInPeak(tariff, checkMoment);
      }
    }
    res.json({ success: true, data: { hasTouData: tariffHasData, inPeak } });
  } catch (error: any) {
    calibLog.error({ err: error }, "Error checking peak status");
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
          calibLog.warn(
            { key },
            "Curve calibration Redis key expired — deleted without recovery",
          );
          sendEmail(
            "Powerwall Notification",
            `[${new Date().toLocaleString()}] An in-progress curve calibration for site ${payload.energySiteId} could not be recovered after server restart (session too old). Please start a new calibration.`,
            payload.email,
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
          calibLog.warn(
            { energySiteId: payload.energySiteId },
            "Curve calibration recovery: site not found — restoring grid charging defensively",
          );
          sendEmail(
            "Powerwall Notification",
            `[${new Date().toLocaleString()}] An in-progress curve calibration for site ${payload.energySiteId} could not be recovered after server restart (site not found). Please start a new calibration.`,
            payload.email,
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
          await finalizeCurveCalibration(payload.energySiteId).catch(() => {});
          calibLog.info(
            { energySiteId: payload.energySiteId },
            "Curve calibration recovered: SOC already complete, finalized",
          );
        } else {
          calibLog.info(
            { energySiteId: payload.energySiteId, jobId: payload.jobId },
            "Curve calibration recovered: resuming background job",
          );
          runCurveCalibration(
            fleet,
            product,
            payload.jobId,
            payload.previousGridState,
            payload.email,
          ).catch((err) =>
            calibLog.error({ err }, "Error in recovered curve calibration job"),
          );
        }
      } catch (err: any) {
        calibLog.error({ err, key }, "Curve calibration recovery failed");
      }
    }
  } catch {
    // Redis unavailable at startup — non-fatal
  }
}
