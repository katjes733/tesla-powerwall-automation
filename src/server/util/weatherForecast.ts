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

  const nowMs = now.valueOf();
  const deadlineMs = deadline.valueOf();
  const forecastSum = forecastPoints
    .filter((p) => p.time.getTime() >= nowMs && p.time.getTime() <= deadlineMs)
    .reduce((sum, p) => sum + p.radiation, 0);

  const nowMins = now.hours() * 60 + now.minutes();
  const deadlineMins = deadline.hours() * 60 + deadline.minutes();

  // Group historical points by calendar day (in the site's own timezone),
  // sum each day's radiation within the same clock window, then average —
  // mirrors solarForecast.ts's own historical-window-matching approach,
  // including its wrap-around-midnight handling.
  const byDate = new Map<string, number>();
  for (const point of historicalPoints) {
    const m = moment.tz(point.time, timezone);
    const todMins = m.hours() * 60 + m.minutes();
    const withinWindow =
      nowMins <= deadlineMins
        ? todMins >= nowMins && todMins < deadlineMins
        : todMins >= nowMins || todMins < deadlineMins;
    if (!withinWindow) continue;
    const dateKey = m.format("YYYY-MM-DD");
    byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + point.radiation);
  }
  if (byDate.size === 0) return null;

  const historicalAvgSum =
    Array.from(byDate.values()).reduce((a, b) => a + b, 0) / byDate.size;
  if (historicalAvgSum <= 0) return null;

  return Math.min(1.0, forecastSum / historicalAvgSum);
}
