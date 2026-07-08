import moment from "moment-timezone";
import { v4 as uuidv4 } from "uuid";
import { Fleet } from "~/server/util/fleet";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity, Product } from "~/server/types/common";
import type {
  ISiteCalibration,
  IGridChargeRateCalibrationData,
} from "~/server/database/models/siteCalibration";
import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import {
  parseTariffContent,
  hasTouData,
  isCurrentlyInPeak,
} from "~/server/util/tariff";
import { redis } from "~/server/util/redis";
import { sendEmail } from "~/server/util/mailing";
import {
  buildChargeCurveBins,
  isValidCandidate,
  SAMPLE_RETENTION_DAYS,
  MAX_CURVE_START_SOC_PERCENT,
} from "~/server/util/curveFit";
import type { ISchedule } from "~/server/database/models/schedule";

export const CALIBRATION_SCHEDULE_ACTIONS = new Set([
  "calibrate_grid_charge_rate",
  "calibrate_charge_curve",
]);

export type OneTimeSchedulePhase =
  | "pending"
  | "succeeded"
  | "failed"
  | "expired";

// A one-time calibration schedule row is never reused across different
// scheduled moments (a fresh Schedule row is created per booking), so these
// fields unambiguously describe the single firing attempt for this exact
// row — no need to cross-reference against the target date.
export function computeOneTimeSchedulePhase(
  schedule: ISchedule,
): OneTimeSchedulePhase {
  if (schedule.enabled) return "pending";
  if (schedule.last_success_time) return "succeeded";
  if (schedule.last_error) return "failed";
  return "expired";
}

// Reconstructs the concrete target date from a one-time schedule's cron
// ("minute hour dayOfMonth month *", built by ScheduleCalibrationDialog.tsx),
// in the schedule's own timezone. Only meaningful for a "pending" schedule —
// a completed one's original target time isn't needed once it has fired.
export function computeOneTimeScheduleNextRun(
  cron: string,
  timezone: string,
): Date {
  const [minute, hour, dayOfMonth, month] = cron.split(" ").map(Number);
  const now = moment.tz(timezone);
  let target = now
    .clone()
    .month(month - 1)
    .date(dayOfMonth)
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);
  // The stored cron has no year — if constructing it against the current
  // year lands in the past, the target must actually be next year.
  if (target.isBefore(now)) {
    target = target.add(1, "year");
  }
  return target.toDate();
}

export const MAX_GRID_RATE_SOC_PERCENT = 80;
export const MAX_CURVE_CALIBRATION_SOC_PERCENT = MAX_CURVE_START_SOC_PERCENT;
export const MAX_SOLAR_KW = 0.1;

const STABILITY_POLL_INTERVAL_MS = 15 * 1000;
const STABILITY_WINDOW = 4;
const STABILITY_TOLERANCE_PERCENT = 5;
const STABILITY_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_DURATION_MS = 3 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 15 * 1000;
export const JOB_TTL_MS = 30 * 60 * 1000;
export const CALIBRATION_TYPE = "grid_charge_rate";

export const CURVE_CALIBRATION_TYPE = "chargeCurve";
export const CURVE_JOB_TTL_MS = 4 * 60 * 60 * 1000;
const CURVE_SAMPLE_INTERVAL_MS = 15 * 1000;
const CURVE_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

type CalibrationPhase = "ramp-up" | "sampling" | "done";
type CalibrationJobStatus = "running" | "complete" | "failed";

export interface CalibrationJob {
  status: CalibrationJobStatus;
  phase: CalibrationPhase;
  startedAt: number;
  siteId?: string;
  error?: string;
  result?: ISiteCalibration & IBasicEntity;
}

export interface CurveCalibrationJob {
  status: "running" | "complete" | "interrupted" | "failed";
  phase: "charging" | "done";
  startSoc: number;
  currentSoc: number;
  sampleCount: number;
  interruptRequested: boolean;
  startedAt: number;
  error?: string;
}

export interface CurveCalibrationRedisPayload {
  jobId: string;
  email: string;
  energySiteId: string;
  productSiteId: string;
  previousGridState: "enabled" | "disabled";
  startSoc: number;
  startedAtMs: number;
}

export const calibrationJobs = new Map<string, CalibrationJob>();
export const calibrationJobBySite = new Map<string, string>(); // energySiteId → jobId
export const curveJobs = new Map<string, CurveCalibrationJob>(); // jobId → job
export const curveJobBySite = new Map<string, string>(); // product.id → jobId

/** Returns true if any calibration (grid rate or curve) is actively running for a site. */
export function isCalibrationRunningForSite(siteId: string): boolean {
  return calibrationJobBySite.has(siteId) || curveJobBySite.has(siteId);
}

export function curveRedisKey(energySiteId: string): string {
  return `curve_calibration_${energySiteId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const calibServiceLog = logger.child({ service: "calibrationService" });

// ---------------------------------------------------------------------------
// Grid charge rate calibration
// ---------------------------------------------------------------------------

export async function runCalibration(
  fleet: Fleet,
  product: Product,
  job: CalibrationJob,
  previousGridState: "enabled" | "disabled",
  email: string,
  sendSuccessEmail = false,
): Promise<void> {
  try {
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
      site_id: String(product.energy_site_id),
      calibration_type: CALIBRATION_TYPE,
      calibration_data: calibrationData as unknown as Record<string, unknown>,
      creation_time: now,
      modified_time: now,
    });

    job.status = "complete";
    job.phase = "done";
    job.result = saved;
    calibServiceLog.info(
      {
        siteId: product.energy_site_id,
        kw: avgRateKw,
        sampleCount: samples.length,
      },
      "Grid charge rate calibration complete",
    );

    if (sendSuccessEmail) {
      sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Scheduled grid charge rate calibration complete for site ${String(product.energy_site_id)}: ${avgRateKw} kW average charge rate (${samples.length} samples).`,
        email,
      );
    }
  } catch (err: any) {
    job.status = "failed";
    job.phase = "done";
    job.error = err?.message ?? "Unknown error";
    calibServiceLog.error({ err }, "Calibration job failed");
    sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] Grid charge rate calibration failed for site ${String(product.energy_site_id)}: ${job.error}`,
      email,
    );
  } finally {
    calibrationJobBySite.delete(String(product.energy_site_id));
    await fleet
      .setGridCharging(product, previousGridState)
      .catch((err: any) => {
        calibServiceLog.error(
          { err },
          "Failed to restore grid charging state after calibration",
        );
        sendEmail(
          "Powerwall Notification",
          `[${new Date().toLocaleString()}] Failed to restore grid charging for site ${String(product.energy_site_id)} after calibration: ${err?.message ?? "Unknown error"}. Please check the site manually.`,
          email,
        );
      });
  }
}

// ---------------------------------------------------------------------------
// Charge curve calibration
// ---------------------------------------------------------------------------

export async function finalizeCurveCalibration(
  energySiteId: string,
): Promise<void> {
  const db = await AppDataSource.getInstance(true);
  const sampleRepo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
    "SiteCalibrationSample",
  );
  const calibRepo = db.getRepository<ISiteCalibration & IBasicEntity>(
    "SiteCalibration",
  );

  const cutoff = new Date(
    Date.now() - SAMPLE_RETENTION_DAYS * 24 * 3600 * 1000,
  );
  const allSamples = (await (sampleRepo as any).find({
    where: { site_id: energySiteId, calibration_type: CURVE_CALIBRATION_TYPE },
    order: { creation_time: "ASC" },
  })) as Array<IBasicEntity & ISiteCalibrationSample>;
  const pooledSamples = allSamples.filter(
    (s) => new Date(s.creation_time as unknown as string) >= cutoff,
  );

  const candidate = buildChargeCurveBins(pooledSamples);

  if (isValidCandidate(candidate)) {
    const now = new Date();
    await calibRepo.save({
      site_id: energySiteId,
      calibration_type: CURVE_CALIBRATION_TYPE,
      calibration_data: candidate as unknown as Record<string, unknown>,
      creation_time: now,
      modified_time: now,
    });
    calibServiceLog.info(
      {
        energySiteId,
        bins: candidate.bins.length,
        samples: candidate.total_sample_count,
      },
      "Curve calibration written to site_calibrations",
    );
  } else {
    calibServiceLog.info(
      { energySiteId },
      "Pooled curve calibration did not meet quality threshold — not written",
    );
  }
}

export async function runCurveCalibration(
  fleet: Fleet,
  product: Product,
  jobId: string,
  previousGridState: "enabled" | "disabled",
  email: string,
  sendSuccessEmail = false,
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

      if (live.percentage_charged >= 100) break;
    }

    job.status = job.interruptRequested ? "interrupted" : "complete";

    if (sendSuccessEmail && job.status === "complete") {
      sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Scheduled charge curve calibration session complete for site ${energySiteId}. Samples collected: ${job.sampleCount}.`,
        email,
      );
    }
  } catch (err: any) {
    job.status = "failed";
    job.error = err?.message ?? "Unknown error";
    calibServiceLog.error({ err }, "Curve calibration job failed");
    sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] Curve calibration failed for site ${String(product.energy_site_id)}: ${job.error}`,
      email,
    );
  } finally {
    job.phase = "done";
    curveJobBySite.delete(String(product.energy_site_id));

    await fleet
      .setGridCharging(product, previousGridState)
      .catch((err: any) => {
        calibServiceLog.error(
          { err },
          "Failed to restore grid charging after curve calibration",
        );
        sendEmail(
          "Powerwall Notification",
          `[${new Date().toLocaleString()}] Failed to restore grid charging for site ${String(product.energy_site_id)} after curve calibration: ${err?.message ?? "Unknown error"}. Please check the site manually.`,
          email,
        );
      });

    try {
      await redis.del(curveRedisKey(energySiteId));
    } catch {
      // non-fatal
    }

    await finalizeCurveCalibration(energySiteId).catch((err: any) =>
      calibServiceLog.error({ err }, "Failed to finalize curve calibration"),
    );
  }
}

// ---------------------------------------------------------------------------
// Trigger functions called by the scheduler
// ---------------------------------------------------------------------------

export async function triggerGridChargeRateCalibration(
  siteId: string,
  email: string,
): Promise<void> {
  const fleet = Fleet.getInstance(email, {
    throwOnError: true,
    mailOnError: false,
  });
  const products = await fleet.getEnergyProducts();
  const product = products.find((p) => String(p.energy_site_id) === siteId);
  if (!product) {
    throw new Error(
      `Site ${siteId} not found for scheduled grid charge rate calibration`,
    );
  }

  if (isCalibrationRunningForSite(siteId)) {
    throw new Error(
      `A calibration is already in progress for site ${siteId} — only one calibration type may run at a time`,
    );
  }

  const [liveStatus, siteInfo] = await Promise.all([
    fleet.getLiveStatus(product),
    fleet.getSiteInfo(product),
  ]);
  if (!liveStatus || !siteInfo) {
    throw new Error(
      `Site data unavailable for scheduled calibration of site ${siteId}`,
    );
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
        `Solar must be below ${MAX_SOLAR_KW} kW (currently ${(liveStatus.solar_power / 1000).toFixed(2)} kW)`,
      !onGrid && "System must be on-grid",
      !offPeakOk && "Must be during off-peak hours",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Scheduled grid charge rate calibration conditions not met for site ${siteId}: ${failed}`,
    );
  }

  const previousGridState =
    siteInfo.components.disallow_charge_from_grid_with_solar_installed === false
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

  runCalibration(fleet, product, job, previousGridState, email, true).catch(
    (err) => {
      calibServiceLog.error(
        { err },
        "Unexpected error in scheduled grid charge rate calibration job",
      );
    },
  );
}

export async function triggerChargeCurveCalibration(
  siteId: string,
  email: string,
): Promise<void> {
  const fleet = Fleet.getInstance(email, {
    throwOnError: true,
    mailOnError: false,
  });
  const products = await fleet.getEnergyProducts();
  const product = products.find((p) => String(p.energy_site_id) === siteId);
  if (!product) {
    throw new Error(
      `Site ${siteId} not found for scheduled charge curve calibration`,
    );
  }

  if (isCalibrationRunningForSite(siteId)) {
    throw new Error(
      `A calibration is already in progress for site ${siteId} — only one calibration type may run at a time`,
    );
  }

  const [liveStatus, siteInfo] = await Promise.all([
    fleet.getLiveStatus(product),
    fleet.getSiteInfo(product),
  ]);
  if (!liveStatus || !siteInfo) {
    throw new Error(
      `Site data unavailable for scheduled curve calibration of site ${siteId}`,
    );
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
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Scheduled charge curve calibration conditions not met for site ${siteId}: ${failed}`,
    );
  }

  const previousGridState =
    siteInfo.components.disallow_charge_from_grid_with_solar_installed === false
      ? "enabled"
      : "disabled";

  await fleet.setGridCharging(product, "enabled");

  const jobId = uuidv4();
  const energySiteId = String(product.energy_site_id);
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

  runCurveCalibration(
    fleet,
    product,
    jobId,
    previousGridState,
    email,
    true,
  ).catch((err) => {
    calibServiceLog.error(
      { err },
      "Unexpected error in scheduled charge curve calibration job",
    );
  });
}
