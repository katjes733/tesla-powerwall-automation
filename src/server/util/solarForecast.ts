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
// Recent-window scaling: compares the last N minutes of actual production to
// historical for the same time-of-day window. Catches cloud cover that develops
// after sunrise, when the cumulative signal (which averages all prior hours) is
// still high. Applied as a lower bound on the final scaling factor so any
// sustained underperformance drives the forecast conservatively downward.
const SOLAR_RECENT_WINDOW_MINUTES = 30;
// Minimum historical average energy in the recent window for the signal to be
// valid. Guards against pre-sunrise windows where tiny absolute values make
// the ratio noisy. Today's value is intentionally not thresholded — near-zero
// today production against a non-trivial historical baseline IS the cloud signal.
const SOLAR_RECENT_WINDOW_MIN_KWH = 0.5;
const SCALING_MIN = 0.1;
const SCALING_MAX = 2.0;
const MIN_VALID_DAYS = 3;
const INTERVAL_HOURS = 5 / 60; // Tesla history is 5-minute intervals
// Conservative discount applied to the historical forecast before comparing
// it against energy needed. Accounts for forecast error and day-to-day
// variability; ensures grid charging isn't skipped on a slightly optimistic
// forecast. Adjust here to tune how aggressively the algorithm relies on solar.
export const SOLAR_FORECAST_DISCOUNT = 0.9;

/**
 * Estimates solar energy (kWh) between now and peakStart using historical
 * 5-minute power data. Two scaling signals are combined conservatively:
 *   1. Cumulative factor: today's production since midnight vs historical average
 *      for the same window — a stable, low-noise day-level weather signal.
 *   2. Recent-window factor: today's production in the last SOLAR_RECENT_WINDOW_MINUTES
 *      vs the historical average for the same time-of-day window — a more responsive
 *      signal that catches cloud cover that developed after sunrise.
 * The lower of the two factors is applied, so any sustained underperformance in
 * either signal drives the forecast conservatively downward.
 * Returns null when there is insufficient history to produce a reliable estimate.
 */
export function estimateSolarKwhFromHistory(
  dataPoints: SolarPowerDataPoint[],
  now: Moment,
  peakStart: Moment,
  timezone: string,
): SolarForecastResult | null {
  if (dataPoints.length === 0) return null;
  // peakStart no longer being after now means the window has already elapsed
  // (e.g. now has ticked past the caller's peak-minus-buffer cutoff but not
  // yet past the real peak) rather than a genuine overnight wrap — comparing
  // only time-of-day minutes below can't tell those apart, since a same-day
  // "already passed" case and a next-day wrap look identical once the date is
  // dropped. Deciding it here, with full date info, avoids that ambiguity.
  if (!peakStart.isAfter(now)) return null;

  const nowMins = now.hours() * 60 + now.minutes();
  const peakMins = peakStart.hours() * 60 + peakStart.minutes();
  const todayKey = now.format("YYYY-MM-DD");
  const recentWindowStartMins = nowMins - SOLAR_RECENT_WINDOW_MINUTES;

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
  const historicalRecentEnergies: number[] = [];

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

    // Recent-window energy for the same historical day — used as the reference
    // for the responsive cloud signal.
    const recentEnergy = readings
      .filter((r) => r.todMins >= recentWindowStartMins && r.todMins <= nowMins)
      .reduce((sum, r) => sum + r.solarKw * INTERVAL_HOURS, 0);
    historicalRecentEnergies.push(recentEnergy);
  }

  if (dailyEnergies.length < MIN_VALID_DAYS) return null;

  const avgHistoricalKwh =
    dailyEnergies.reduce((a, b) => a + b, 0) / dailyEnergies.length;
  const avgHistoricalEnergyToNow =
    historicalEnergyToNow.reduce((a, b) => a + b, 0) /
    historicalEnergyToNow.length;
  const avgHistoricalRecentEnergy =
    historicalRecentEnergies.reduce((a, b) => a + b, 0) /
    historicalRecentEnergies.length;

  // Today's cumulative energy from start of day up to now.
  const todayReadings = byDate.get(todayKey) ?? [];
  const todayEnergyToNow = todayReadings
    .filter((r) => r.todMins <= nowMins)
    .reduce((sum, r) => sum + r.solarKw * INTERVAL_HOURS, 0);
  // Today's energy in the recent window.
  const todayRecentEnergy = todayReadings
    .filter((r) => r.todMins >= recentWindowStartMins && r.todMins <= nowMins)
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

  // Apply the recent-window factor only when:
  //  - today already has sufficient cumulative production (same guard as above,
  //    so we know what kind of day it is before comparing the recent window), AND
  //  - the historical signal in this window is meaningful (guards pre-sunrise noise).
  // Take the minimum: if either signal detects underperformance, the forecast goes down.
  if (
    todayEnergyToNow >= MIN_CUMULATIVE_FOR_SCALING_KWH &&
    avgHistoricalRecentEnergy >= SOLAR_RECENT_WINDOW_MIN_KWH
  ) {
    const recentFactor = Math.min(
      Math.max(todayRecentEnergy / avgHistoricalRecentEnergy, SCALING_MIN),
      SCALING_MAX,
    );
    scalingFactor = Math.min(scalingFactor, recentFactor);
  }

  return {
    estimatedKwh: avgHistoricalKwh * scalingFactor,
    scalingFactor,
    daysUsed: dailyEnergies.length,
  };
}
