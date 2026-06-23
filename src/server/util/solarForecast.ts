import moment from "moment-timezone";
import type { Moment } from "moment-timezone";
import type { SolarPowerDataPoint } from "~/server/types/common";

export interface SolarForecastResult {
  estimatedKwh: number;
  scalingFactor: number; // 1.0 when weather scaling was not applied
  daysUsed: number;
}

// Minimum cumulative solar energy today (kWh from day-start to now) required
// before applying weather scaling. Avoids noise early in the morning when
// only a handful of 5-minute slots have been recorded.
const MIN_CUMULATIVE_FOR_SCALING_KWH = 0.5;
const SCALING_MIN = 0.1;
const SCALING_MAX = 2.0;
const MIN_VALID_DAYS = 3;
const INTERVAL_HOURS = 5 / 60; // Tesla history is 5-minute intervals

/**
 * Estimates solar energy (kWh) between now and peakStart using historical
 * 5-minute power data. Scales the historical average by comparing today's
 * cumulative solar production (day-start → now) against the historical average
 * for the same window, producing a stable day-level weather signal rather than
 * reacting to instantaneous fluctuations.
 * Returns null when there is insufficient history to produce a reliable estimate.
 */
export function estimateSolarKwhFromHistory(
  dataPoints: SolarPowerDataPoint[],
  now: Moment,
  peakStart: Moment,
  timezone: string,
): SolarForecastResult | null {
  if (dataPoints.length === 0) return null;

  const nowMins = now.hours() * 60 + now.minutes();
  const peakMins = peakStart.hours() * 60 + peakStart.minutes();
  const todayKey = now.format("YYYY-MM-DD");

  // Group data points by site-local calendar date.
  type Reading = { todMins: number; solarKw: number };
  const byDate = new Map<string, Reading[]>();
  for (const dp of dataPoints) {
    const m = moment.tz(dp.timestamp, timezone);
    const key = m.format("YYYY-MM-DD");
    const reading: Reading = {
      todMins: m.hours() * 60 + m.minutes(),
      solarKw: dp.solar_power / 1000,
    };
    const bucket = byDate.get(key);
    if (bucket) {
      bucket.push(reading);
    } else {
      byDate.set(key, [reading]);
    }
  }

  const dailyEnergies: number[] = [];
  const historicalEnergyToNow: number[] = [];

  for (const [date, readings] of byDate.entries()) {
    if (date === todayKey) continue; // today handled separately below

    // Handle windows that wrap midnight (nowMins > peakMins, e.g. 22:00 → 08:00).
    const windowReadings = readings.filter((r) =>
      nowMins <= peakMins
        ? r.todMins >= nowMins && r.todMins < peakMins
        : r.todMins >= nowMins || r.todMins < peakMins,
    );
    // Skip days with no readings in the window or where solar was zero throughout
    // (e.g. night-time windows, fully overcast days, data outages).
    if (
      windowReadings.length === 0 ||
      windowReadings.every((r) => r.solarKw === 0)
    )
      continue;

    const energyKwh = windowReadings.reduce(
      (sum, r) => sum + r.solarKw * INTERVAL_HOURS,
      0,
    );
    dailyEnergies.push(energyKwh);

    // Cumulative energy from start of day up to now — used for weather scaling.
    const energyToNow = readings
      .filter((r) => r.todMins <= nowMins)
      .reduce((sum, r) => sum + r.solarKw * INTERVAL_HOURS, 0);
    historicalEnergyToNow.push(energyToNow);
  }

  if (dailyEnergies.length < MIN_VALID_DAYS) return null;

  const avgHistoricalKwh =
    dailyEnergies.reduce((a, b) => a + b, 0) / dailyEnergies.length;
  const avgHistoricalEnergyToNow =
    historicalEnergyToNow.reduce((a, b) => a + b, 0) /
    historicalEnergyToNow.length;

  // Today's cumulative energy from start of day up to now.
  const todayReadings = byDate.get(todayKey) ?? [];
  const todayEnergyToNow = todayReadings
    .filter((r) => r.todMins <= nowMins)
    .reduce((sum, r) => sum + r.solarKw * INTERVAL_HOURS, 0);

  // Scale only when both today and history have sufficient cumulative solar signal.
  // Below the threshold (pre-sunrise, early morning) the raw historical average is used.
  let scalingFactor = 1.0;
  if (
    todayEnergyToNow >= MIN_CUMULATIVE_FOR_SCALING_KWH &&
    avgHistoricalEnergyToNow >= MIN_CUMULATIVE_FOR_SCALING_KWH
  ) {
    scalingFactor = Math.min(
      Math.max(todayEnergyToNow / avgHistoricalEnergyToNow, SCALING_MIN),
      SCALING_MAX,
    );
  }

  return {
    estimatedKwh: avgHistoricalKwh * scalingFactor,
    scalingFactor,
    daysUsed: dailyEnergies.length,
  };
}
