import moment from "moment-timezone";
import type { Moment } from "moment-timezone";
import type { SolarPowerDataPoint } from "~/server/types/common";

export interface SolarForecastResult {
  estimatedKwh: number;
  scalingFactor: number; // 1.0 when weather scaling was not applied
  daysUsed: number;
}

const MIN_SOLAR_FOR_SCALING_KW = 0.3;
const SCALING_MIN = 0.1;
const SCALING_MAX = 2.0;
const MIN_VALID_DAYS = 3;
const INTERVAL_HOURS = 5 / 60; // Tesla history is 5-minute intervals

/**
 * Estimates solar energy (kWh) between now and peakStart using historical
 * 5-minute power data. Scales the average by today's actual solar output
 * compared to the historical average at the same time of day.
 * Returns null when there is insufficient history to produce a reliable estimate.
 */
export function estimateSolarKwhFromHistory(
  dataPoints: SolarPowerDataPoint[],
  now: Moment,
  peakStart: Moment,
  currentSolarKw: number,
  timezone: string,
): SolarForecastResult | null {
  if (dataPoints.length === 0) return null;

  const nowMins = now.hours() * 60 + now.minutes();
  const peakMins = peakStart.hours() * 60 + peakStart.minutes();

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
  const dailySolarAtNow: number[] = [];

  for (const readings of byDate.values()) {
    const windowReadings = readings.filter(
      (r) => r.todMins >= nowMins && r.todMins < peakMins,
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

    // Find the reading closest to the current time of day for weather scaling.
    const closest = readings.reduce((best, r) =>
      Math.abs(r.todMins - nowMins) < Math.abs(best.todMins - nowMins)
        ? r
        : best,
    );
    dailySolarAtNow.push(closest.solarKw);
  }

  if (dailyEnergies.length < MIN_VALID_DAYS) return null;

  const avgHistoricalKwh =
    dailyEnergies.reduce((a, b) => a + b, 0) / dailyEnergies.length;
  const avgHistoricalAtNow =
    dailySolarAtNow.reduce((a, b) => a + b, 0) / dailySolarAtNow.length;

  // Only scale when both sides carry meaningful solar signal. Below the
  // threshold (pre-sunrise, heavy overcast) the raw historical average is used.
  let scalingFactor = 1.0;
  if (
    currentSolarKw >= MIN_SOLAR_FOR_SCALING_KW &&
    avgHistoricalAtNow >= MIN_SOLAR_FOR_SCALING_KW
  ) {
    scalingFactor = Math.min(
      Math.max(currentSolarKw / avgHistoricalAtNow, SCALING_MIN),
      SCALING_MAX,
    );
  }

  return {
    estimatedKwh: avgHistoricalKwh * scalingFactor,
    scalingFactor,
    daysUsed: dailyEnergies.length,
  };
}
