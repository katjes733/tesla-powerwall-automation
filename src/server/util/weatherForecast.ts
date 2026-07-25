// Open-Meteo's free tier (no API key) is licensed for non-commercial use
// only. This app is personal/home use, so the free tier applies today. If
// this project is ever used commercially, a paid subscription would be
// required — see https://open-meteo.com/en/pricing.
import { fetchWeatherApi } from "openmeteo";
import moment, { type Moment } from "moment-timezone";

// Matches fleet.ts's getSolarHistory default trailing window — not coupled
// to solarForecast.ts's internals, just the same rolling lookback.
export const RADIATION_HISTORY_DAYS = 7;

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

export interface RadiationPoint {
  time: Date;
  radiation: number;
}

async function fetchHourlyRadiation(
  url: string,
  params: Record<string, unknown>,
): Promise<RadiationPoint[] | null> {
  try {
    const responses = await fetchWeatherApi(url, {
      ...params,
      hourly: ["shortwave_radiation"],
    });
    const hourly = responses[0]?.hourly();
    if (!hourly) return null;
    const utcOffsetSeconds = responses[0].utcOffsetSeconds();
    const radiation = hourly.variables(0)?.valuesArray();
    if (!radiation) return null;

    const length = Number(hourly.timeEnd() - hourly.time()) / hourly.interval();
    const points: RadiationPoint[] = [];
    for (let i = 0; i < length; i++) {
      points.push({
        time: new Date(
          (Number(hourly.time()) + i * hourly.interval() + utcOffsetSeconds) *
            1000,
        ),
        radiation: radiation[i],
      });
    }
    return points;
  } catch {
    return null;
  }
}

// No API key required. `timezone` is passed as the site's own explicit IANA
// zone (not "auto") for consistency with how the rest of this codebase
// always uses an explicit moment-timezone zone rather than auto-detection.
export async function fetchRadiationForecast(
  lat: number,
  lon: number,
  timezone: string,
): Promise<RadiationPoint[] | null> {
  return fetchHourlyRadiation(FORECAST_URL, {
    latitude: lat,
    longitude: lon,
    timezone,
    forecast_days: 2,
  });
}

export async function fetchHistoricalRadiation(
  lat: number,
  lon: number,
  timezone: string,
  days: number = RADIATION_HISTORY_DAYS,
): Promise<RadiationPoint[] | null> {
  const endDate = moment.tz(timezone).subtract(1, "day");
  const startDate = endDate.clone().subtract(days - 1, "days");
  return fetchHourlyRadiation(ARCHIVE_URL, {
    latitude: lat,
    longitude: lon,
    timezone,
    start_date: startDate.format("YYYY-MM-DD"),
    end_date: endDate.format("YYYY-MM-DD"),
  });
}

const HOURLY_INTERVAL_MINUTES = 60;

interface OverlapSum {
  sum: number;
  hadOverlap: boolean;
}

// Overlaps each hourly point's own HOURLY_INTERVAL_MINUTES-wide bucket
// against [fromMins, toMins) rather than requiring the point's time-of-day
// to fall strictly inside it. Mirrors solarForecast.ts's windowEnergyKwh:
// Open-Meteo data is hourly, so a window narrower than an hour (routine in
// the minutes right before any deadline) would otherwise catch zero grid
// points depending on alignment, flickering the ratio between "found a
// point" and null.
function windowOverlapSum(
  points: { todMins: number; radiation: number }[],
  fromMins: number,
  toMins: number,
): OverlapSum {
  let sum = 0;
  let hadOverlap = false;
  for (const p of points) {
    const bucketStart = p.todMins;
    const bucketEnd = p.todMins + HOURLY_INTERVAL_MINUTES;
    const overlapMins =
      Math.min(bucketEnd, toMins) - Math.max(bucketStart, fromMins);
    if (overlapMins > 0) {
      hadOverlap = true;
      sum += p.radiation * (overlapMins / HOURLY_INTERVAL_MINUTES);
    }
  }
  return { sum, hadOverlap };
}

function addOverlapSum(a: OverlapSum, b: OverlapSum): OverlapSum {
  return { sum: a.sum + b.sum, hadOverlap: a.hadOverlap || b.hadOverlap };
}

// Sums forecasted radiation over [now, deadline] and historical average
// radiation over the same clock window across the lookback days, returning
// min(1.0, forecastSum / historicalAvgSum) — clamped so a better-than-average
// forecast never boosts a solar estimate, only a worse one can pull it down.
// Returns null if either side is unavailable, mirroring
// estimateSolarKwhFromHistory's own null-on-insufficient-data convention.
export function computeRadiationRatio(
  forecastPoints: RadiationPoint[],
  historicalPoints: RadiationPoint[],
  now: Moment,
  deadline: Moment,
  timezone: string,
): number | null {
  if (forecastPoints.length === 0 || historicalPoints.length === 0) {
    return null;
  }

  // Forecast points already carry absolute timestamps for the real window
  // being evaluated, so overlap them directly in epoch-ms space — no
  // calendar-day wrap ambiguity to resolve here.
  const nowMs = now.valueOf();
  const deadlineMs = deadline.valueOf();
  const intervalMs = HOURLY_INTERVAL_MINUTES * 60 * 1000;
  let forecastSum = 0;
  let forecastHadOverlap = false;
  for (const p of forecastPoints) {
    const bucketStart = p.time.getTime();
    const bucketEnd = bucketStart + intervalMs;
    const overlapMs =
      Math.min(bucketEnd, deadlineMs) - Math.max(bucketStart, nowMs);
    if (overlapMs > 0) {
      forecastHadOverlap = true;
      forecastSum += p.radiation * (overlapMs / intervalMs);
    }
  }
  if (!forecastHadOverlap) return null;

  const nowMins = now.hours() * 60 + now.minutes();
  const deadlineMins = deadline.hours() * 60 + deadline.minutes();
  const wraps = nowMins > deadlineMins;

  // Group historical points by calendar day (in the site's own timezone),
  // then overlap-integrate the same clock window on each date — mirrors
  // solarForecast.ts's own historical-window-matching approach, including
  // its wrap-around-midnight handling.
  const byDate = new Map<string, { todMins: number; radiation: number }[]>();
  for (const point of historicalPoints) {
    const m = moment.tz(point.time, timezone);
    const dateKey = m.format("YYYY-MM-DD");
    const reading = {
      todMins: m.hours() * 60 + m.minutes(),
      radiation: point.radiation,
    };
    const bucket = byDate.get(dateKey);
    if (bucket) {
      bucket.push(reading);
    } else {
      byDate.set(dateKey, [reading]);
    }
  }

  let historicalTotal = 0;
  let daysUsed = 0;
  for (const points of byDate.values()) {
    const { sum, hadOverlap } = wraps
      ? addOverlapSum(
          windowOverlapSum(points, nowMins, 24 * 60),
          windowOverlapSum(points, 0, deadlineMins),
        )
      : windowOverlapSum(points, nowMins, deadlineMins);
    // No data at all for this date/window — skip; don't count as a zero day.
    if (!hadOverlap) continue;
    historicalTotal += sum;
    daysUsed += 1;
  }
  if (daysUsed === 0) return null;

  const historicalAvgSum = historicalTotal / daysUsed;
  if (historicalAvgSum <= 0) return null;

  return Math.min(1.0, forecastSum / historicalAvgSum);
}
