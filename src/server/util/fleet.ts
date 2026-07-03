import { jwtDecode } from "jwt-decode";
import moment from "moment-timezone";
import type {
  FleetOptions,
  FleetOptionsInput,
  IBasicEntity,
  JWT,
  LiveStatus,
  PowerHistoryPoint,
  Product,
  RefreshTokenData,
  SiteInfo,
  SmartChargingActionConfig,
  SocPoint,
  SolarPowerDataPoint,
  TokenData,
} from "~/server/types/common";
import type {
  HolidayEntry,
  IScheduleCondition,
  SeasonalWindow,
} from "~/server/database/models/schedule";
import type { ITouBackup } from "~/server/database/models/touBackup";
import type {
  ISiteCalibration,
  IGridChargeRateCalibrationData,
} from "~/server/database/models/siteCalibration";
import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import { type ChargeCurveCalibrationData } from "~/server/util/curveFit";
import type {
  SiteEventType,
  ISiteEvent,
} from "~/server/database/models/siteEvent";
import AppDataSource from "~/server/database/datasource";
import { IsNull } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { isObservedHolidayOnDate } from "~/server/util/holidays";
import { getNewTokenWithRefreshToken } from "~/server/util/auth";
import { retry } from "~/server/util/retry";
import { sendEmail } from "./mailing";
import {
  upsert as upsertToken,
  getByEmail as getRefreshTokenByEmail,
} from "~/server/util/routes/refreshToken";
import {
  calculateChargeRateKw,
  calculateGridChargeHours,
  calculateTotalCapacityKwh,
  PEAK_BUFFER_MINUTES,
} from "~/server/util/chargeRate";
import {
  parseTariffContent,
  hasTouData,
  isCurrentlyInPeak,
  findNextPeakStart,
  getCurrentSeason,
  isWithinWindow,
} from "~/server/util/tariff";
import { redis } from "~/server/util/redis";
import {
  estimateSolarKwhFromHistory,
  SOLAR_FORECAST_DISCOUNT,
  type SolarForecastResult,
} from "~/server/util/solarForecast";
import { maskEmail } from "~/server/util/maskEmail";

export interface SmartChargingData {
  desired: "enabled" | "disabled";
  current: "enabled" | "disabled";
  action: "enabled" | "disabled" | "no_change";
  soc: number;
  targetSoc: number;
  forecastMethod: "historical" | "linear-fallback";
  estimatedSolarKwh: number | null;
  weatherFactor: number | null;
  batteryChargeRateFromGridKw: number | null;
  liveKw: { solar: number; load: number; grid: number; battery: number };
  chargeRateKw: number;
  chargeRateSource: "calibrated" | "formula";
  chargeRateCurveSource: "lookup" | "defaults";
  reason: string;
}

interface BackupReserveData {
  percent: number;
}
interface EnergyExportsData {
  rule: string;
  apiRule: string;
}
interface GridChargingData {
  setting: string;
  disallow: boolean;
}
interface TouHolidayData {
  today: string;
  holidayAction: "override" | "restore" | "none";
}
interface OperationalModeData {
  mode: string;
  apiMode: string;
}

const SITE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const siteInfoCache = new Map<number, { info: SiteInfo; at: number }>();

const LIVE_STATUS_CACHE_TTL_MS = 30 * 1000;
const liveStatusCache = new Map<number, { status: LiveStatus; at: number }>();

const CALIBRATION_CACHE_TTL_MS = 5 * 60 * 1000;
const calibrationCache = new Map<
  string,
  { data: (ISiteCalibration & IBasicEntity) | null; at: number }
>();

const CURVE_CACHE_TTL_MS = 30 * 60 * 1000;
const curveCache = new Map<
  string,
  { data: ChargeCurveCalibrationData | null; at: number }
>();

// Ring buffer: last N battery_power readings per site (one per minute from cron).
// Used to detect a sustained discharge during what should be an idle period.
const DISCHARGE_BUFFER_SIZE = 10;
const DISCHARGE_MIN_POWER_W = 300;
const dischargeBuffer = new Map<number, number[]>();
const dischargeCalibrationActive = new Map<number, boolean>();

export function isDischargeCalibrating(siteId: number): boolean {
  return dischargeCalibrationActive.get(siteId) ?? false;
}

function formatScheduledTime(t: moment.Moment, now: moment.Moment): string {
  if (t.isSame(now, "day")) return t.format("HH:mm");
  if (t.isSame(now.clone().add(1, "day"), "day"))
    return `tomorrow ${t.format("HH:mm")}`;
  return `${t.format("ddd")} ${t.format("HH:mm")}`;
}

function buildSolarLabel(
  forecast: SolarForecastResult | null,
  linearKwh: number,
): string {
  if (forecast) {
    const scalePart =
      forecast.scalingFactor !== 1.0
        ? ` ×${forecast.scalingFactor.toFixed(2)} weather`
        : "";
    return `solar forecast ${forecast.estimatedKwh.toFixed(2)}kWh via ${forecast.daysUsed}-day history${scalePart}`;
  }
  return `solar forecast ${linearKwh.toFixed(2)}kWh via linear fallback`;
}

const baseApiUrl =
  process.env.TESLA_API_BASE_URL ||
  "https://fleet-api.prd.na.vn.cloud.tesla.com";

/**
 * Returns true when the live status matches the signature of a Powerwall 3
 * BMS calibration cycle: SOC frozen at 0%, battery locked out (power = 0),
 * grid healthy, no storm mode. The battery never truly depletes — Tesla's
 * firmware reports 0% while the calibration runs, then snaps back to the
 * actual SOC when complete.
 */
export function isCalibrating(live: LiveStatus): boolean {
  return (
    live.percentage_charged < 1 &&
    live.battery_power === 0 &&
    live.island_status === "on_grid" &&
    !live.storm_mode_active
  );
}

export const ALLOWED_ACTIONS = new Set([
  "setBackupReserve",
  "setSoftBackupReserve",
  "setEnergyExports",
  "setGridCharging",
  "setSmartGridCharging",
  "setTouHolidayOverride",
  "setOperationalMode",
]);

export class Fleet {
  private static instanceMap = new Map<string, Fleet>();

  private email: string;
  private token: string = "";
  private tokenExpiresAt: number = 0;
  private refreshToken: string = "";
  private options: FleetOptions;
  private tokenRefreshPromise: Promise<string> | null = null;
  private readonly log: ReturnType<typeof logger.child>;

  private energyProducts: Product[] = [];
  private _actionMap: Record<string, Function>;

  private constructor(email: string, options?: FleetOptionsInput) {
    this.email = email;
    this.log = logger.child({ service: "fleet", email: maskEmail(email) });
    this.options = {
      mailOnError: options?.mailOnError ?? false,
      throwOnError: options?.throwOnError ?? true,
    };
    this._actionMap = {};
    for (const key of ALLOWED_ACTIONS) {
      this._actionMap[key] = (this as any)[key].bind(this);
    }
  }

  public static getInstance(email: string, options?: FleetOptionsInput): Fleet {
    if (!Fleet.instanceMap.has(email)) {
      Fleet.instanceMap.set(email, new Fleet(email, options));
    }
    return Fleet.instanceMap.get(email) as Fleet;
  }

  public getActionMap() {
    return this._actionMap;
  }

  async getToken(): Promise<string> {
    if (!this.refreshToken) {
      const result = await getRefreshTokenByEmail(this.email);
      if (result) {
        const { refreshToken } = result as RefreshTokenData;
        this.refreshToken = refreshToken;
      } else {
        throw new Error("Refresh token not found for email: " + this.email);
      }
    }

    if (this.token && this.tokenExpiresAt > Date.now()) {
      return this.token;
    }

    // Deduplicate concurrent refresh calls — rotating tokens mean a second
    // in-flight request would use an already-invalidated refresh token → 401.
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.doTokenRefresh().finally(() => {
      this.tokenRefreshPromise = null;
    });
    return this.tokenRefreshPromise;
  }

  private async doTokenRefresh(): Promise<string> {
    const tokenResponse = await getNewTokenWithRefreshToken(this.refreshToken);
    if (!tokenResponse.ok) {
      const errorMsg = `Failed to obtain new token with refresh token: ${tokenResponse.status} ${tokenResponse.statusText}`;
      this.log.error({ status: tokenResponse.status }, "Token refresh failed");
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Tesla API token refresh failed. Please check the server logs and re-authenticate if necessary.`,
        this.email,
        this.options.mailOnError,
      );
      throw new Error(errorMsg);
    }
    const tokenData = (await tokenResponse.json()) as TokenData;
    this.token = "";
    this.refreshToken = "";
    this.token = tokenData.access_token;
    // jwt-decode only base64-decodes the payload; it does not verify the signature.
    // The token arrives over TLS from Tesla's token endpoint, so tampering is unlikely.
    // If Tesla publishes a JWKS endpoint, replace jwt-decode with jose's jwtVerify() to
    // cryptographically verify the signature before trusting any claim.
    this.tokenExpiresAt = jwtDecode<JWT>(this.token).exp * 1000;
    this.refreshToken = tokenData.refresh_token;
    await upsertToken({
      email: this.email,
      refreshToken: this.refreshToken,
      expiresAt: new Date(this.tokenExpiresAt),
    });

    this.log.info("Token refreshed successfully");

    return this.token;
  }

  async getDefaultGetOptions() {
    return {
      // signal: AbortSignal.timeout(5000),
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await this.getToken()}`,
      },
    };
  }

  async getDefaultPostOptions() {
    return {
      // signal: AbortSignal.timeout(5000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await this.getToken()}`,
      },
    };
  }

  async getEnergyProducts(): Promise<Product[]> {
    const url = new URL("/api/1/products", baseApiUrl).toString();
    const options = await this.getDefaultGetOptions();
    try {
      const { response } = await retry<Record<string, any>>(
        async () => {
          const res = await fetch(url, options);
          if (!res.ok) {
            throw new Error(
              `Error getting Energy Products: ${res.status} ${res.statusText}`,
            );
          }
          return (await res.json()) as Record<string, any>;
        },
        3,
        2000,
        2,
      );
      const products = response as Product[];
      this.energyProducts = products.filter(
        (product) => product.energy_site_id,
      );
      return this.energyProducts;
    } catch (error: any) {
      const errorMsg = `Error getting Energy Products after retries: ${error.message}`;
      this.log.error(
        { err: error },
        "Error getting energy products after retries",
      );
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to retrieve energy products from the Tesla API. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
      return [];
    }
  }

  async getSiteInfo(product: Product): Promise<SiteInfo | null> {
    const cached = siteInfoCache.get(product.energy_site_id);
    if (cached && performance.now() - cached.at < SITE_INFO_CACHE_TTL_MS) {
      return cached.info;
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/site_info`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultGetOptions();
    try {
      const { response } = await retry<Record<string, any>>(
        async () => {
          const res = await fetch(url, options);
          if (!res.ok) {
            throw new Error(
              `Error getting Site Info for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return (await res.json()) as Record<string, any>;
        },
        3,
        2000,
        2,
      );
      const siteInfo = response as SiteInfo;
      siteInfoCache.set(product.energy_site_id, {
        info: siteInfo,
        at: performance.now(),
      });
      return siteInfo;
    } catch (error: any) {
      const errorMsg = `Error getting Site Info for Energy Site ${product.energy_site_id} after retries: ${error.message}`;
      siteLog.error({ err: error }, "Error getting site info after retries");
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to retrieve site info for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
      return null;
    }
  }

  async getLiveStatus(product: Product): Promise<LiveStatus | null> {
    const cached = liveStatusCache.get(product.energy_site_id);
    if (cached && performance.now() - cached.at < LIVE_STATUS_CACHE_TTL_MS) {
      return cached.status;
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/live_status`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultGetOptions();
    try {
      const { response } = await retry<Record<string, any>>(
        async () => {
          const res = await fetch(url, options);
          if (!res.ok) {
            throw new Error(
              `Error getting Live Status for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return (await res.json()) as Record<string, any>;
        },
        3,
        2000,
        2,
      );
      const liveStatus = response as LiveStatus;
      liveStatusCache.set(product.energy_site_id, {
        status: liveStatus,
        at: performance.now(),
      });
      return liveStatus;
    } catch (error: any) {
      const errorMsg = `Error getting Live Status for Energy Site ${product.energy_site_id} after retries: ${error.message}`;
      siteLog.error({ err: error }, "Error getting live status after retries");
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to retrieve live status for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
      return null;
    }
  }

  // Fetch one day of 5-min power data from the Tesla calendar_history API.
  // dateStr is a YYYY-MM-DD string in the site's local timezone.
  private async fetchDayHistory(
    product: Product,
    timezone: string,
    dateStr: string,
    options: { method: string; headers: Record<string, string> },
  ): Promise<PowerHistoryPoint[]> {
    // The API treats end_date as exclusive and returns empty data at midnight.
    // 23:59 covers all five-minute slots through 23:55 without hitting that edge case.
    const endDate = moment
      .tz(`${dateStr} 23:59`, "YYYY-MM-DD HH:mm", timezone)
      .format("YYYY-MM-DDTHH:mm:ssZ");
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/calendar_history`,
      baseApiUrl,
    );
    url.searchParams.set("kind", "power");
    url.searchParams.set("end_date", endDate);
    try {
      const { response } = await retry<Record<string, any>>(
        async () => {
          const res = await fetch(url.toString(), options);
          if (!res.ok) {
            throw new Error(
              `Error fetching solar history for site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return (await res.json()) as Record<string, any>;
        },
        3,
        2000,
        2,
      );
      return ((response.time_series ?? []) as Record<string, any>[]).map(
        (pt) => {
          const solar = (pt.solar_power as number) ?? 0;
          const battery = (pt.battery_power as number) ?? 0;
          const grid = (pt.grid_power as number) ?? 0;
          // Tesla API returns load_power=0 for some sites; derive from energy balance.
          const load = Math.max(0, solar + battery + grid);
          return {
            timestamp: (pt.timestamp as string) ?? "",
            solar_power: solar,
            battery_power: battery,
            grid_power: grid,
            load_power: load,
          };
        },
      );
    } catch (error: any) {
      this.log
        .child({
          siteId: String(product.energy_site_id),
          siteName: product.site_name,
        })
        .warn({ err: error, date: dateStr }, "Solar history day fetch failed");
      return [];
    }
  }

  // Public: fetch one day of full power history with Redis caching.
  // forceRefresh bypasses the cache (only meaningful for today's data).
  async getDayHistory(
    product: Product,
    timezone: string,
    dateStr: string,
    forceRefresh = false,
  ): Promise<{ points: PowerHistoryPoint[]; cached: boolean }> {
    const isToday = moment().tz(timezone).format("YYYY-MM-DD") === dateStr;
    const cacheKey = `power_history:${product.energy_site_id}:${dateStr}`;

    if (!forceRefresh) {
      try {
        const raw = await redis.get(cacheKey);
        if (raw) {
          return {
            points: JSON.parse(raw) as PowerHistoryPoint[],
            cached: true,
          };
        }
      } catch {
        // Redis unavailable — fall through.
      }
    }

    const options = await this.getDefaultGetOptions();
    const rawPoints = await this.fetchDayHistory(
      product,
      timezone,
      dateStr,
      options,
    );

    // Tesla returns a full day's worth of 5-minute slots, including future ones
    // filled with zeros. Strip those so charts don't show a flat line at 0 for
    // the portion of the day that hasn't happened yet.
    const now = moment();
    const points = isToday
      ? rawPoints.filter((p) => !moment(p.timestamp).isAfter(now))
      : rawPoints;

    try {
      const ttl = isToday ? 5 * 60 : 30 * 24 * 3600;
      await redis.setex(cacheKey, ttl, JSON.stringify(points));
    } catch {
      // Redis write failed — non-fatal.
    }

    return { points, cached: false };
  }

  async getDaySoeHistory(
    product: Product,
    timezone: string,
    dateStr: string,
    forceRefresh = false,
  ): Promise<{ points: SocPoint[]; cached: boolean }> {
    const isToday = moment().tz(timezone).format("YYYY-MM-DD") === dateStr;
    const cacheKey = `soe_history:${product.energy_site_id}:${dateStr}`;

    if (!forceRefresh) {
      try {
        const raw = await redis.get(cacheKey);
        if (raw) {
          return { points: JSON.parse(raw) as SocPoint[], cached: true };
        }
      } catch {
        // Redis unavailable — fall through.
      }
    }

    const endDate = moment
      .tz(`${dateStr} 23:59`, "YYYY-MM-DD HH:mm", timezone)
      .format("YYYY-MM-DDTHH:mm:ssZ");
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/calendar_history`,
      baseApiUrl,
    );
    url.searchParams.set("kind", "soe");
    url.searchParams.set("end_date", endDate);

    const options = await this.getDefaultGetOptions();
    const res = await fetch(url.toString(), options);
    if (!res.ok) {
      throw new Error(
        `SOE history fetch failed for site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json()) as Record<string, any>;
    const raw15 = (json?.response?.time_series ?? []) as Array<{
      timestamp: string;
      soe: number;
    }>;

    // Linearly interpolate 15-minute snapshots to 5-minute resolution so the
    // SOC chart aligns with the power history chart (also 5-minute).
    const interpolated: SocPoint[] = [];
    for (let i = 0; i < raw15.length; i++) {
      const cur = raw15[i];
      interpolated.push({
        timestamp: cur.timestamp,
        soc_percent: Math.round(cur.soe * 10) / 10,
      });
      const next = raw15[i + 1];
      if (next) {
        const t0 = moment(cur.timestamp).valueOf();
        const t1 = moment(next.timestamp).valueOf();
        const gapMs = t1 - t0;
        // Only interpolate when the gap is exactly 15 minutes.
        if (gapMs === 15 * 60 * 1000) {
          for (const frac of [1 / 3, 2 / 3]) {
            interpolated.push({
              timestamp: moment(t0 + gapMs * frac).toISOString(),
              soc_percent:
                Math.round((cur.soe + (next.soe - cur.soe) * frac) * 10) / 10,
            });
          }
        }
      }
    }

    // Strip future slots for today.
    const now = moment();
    const points = isToday
      ? interpolated.filter((p) => !moment(p.timestamp).isAfter(now))
      : interpolated;

    try {
      const ttl = isToday ? 5 * 60 : 30 * 24 * 3600;
      await redis.setex(cacheKey, ttl, JSON.stringify(points));
    } catch {
      // Redis write failed — non-fatal.
    }

    return { points, cached: false };
  }

  async getSolarHistory(
    product: Product,
    timezone: string,
    days = 7,
  ): Promise<SolarPowerDataPoint[]> {
    const cacheKey = `solar_history:${product.energy_site_id}`;
    const nowLocal = moment().tz(timezone);

    // Cache format: { refreshAfter: ISO string, points: SolarPowerDataPoint[] }.
    // refreshAfter controls logical freshness; the Redis TTL is intentionally
    // longer so existing points survive past midnight and can be reused
    // incrementally — only missing days are fetched on each refresh.
    let cachedPoints: SolarPowerDataPoint[] = [];
    try {
      const raw = await redis.get(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Legacy format (raw array) — treat as stale so it re-stores in new format.
          cachedPoints = parsed as SolarPowerDataPoint[];
        } else {
          const cache = parsed as {
            refreshAfter: string;
            points: SolarPowerDataPoint[];
          };
          if (moment(cache.refreshAfter).isAfter(nowLocal)) {
            return cache.points; // still fresh
          }
          cachedPoints = cache.points;
        }
      }
    } catch {
      // Redis unavailable — fall through to API fetch.
    }

    // Determine which of the past `days` completed days are absent from the
    // cache. On cold start all 7 are missing; in steady state just 1.
    const neededDates = Array.from({ length: days }, (_, i) =>
      nowLocal
        .clone()
        .subtract(i + 1, "days")
        .format("YYYY-MM-DD"),
    );
    const todayDate = nowLocal.format("YYYY-MM-DD");

    // Exclude today from the cached-set check — today's data is always re-fetched
    // on each cache refresh so the weather scaling factor stays current.
    const cachedDateSet = new Set(
      cachedPoints
        .filter(
          (p) =>
            moment.tz(p.timestamp, timezone).format("YYYY-MM-DD") !== todayDate,
        )
        .map((p) => moment.tz(p.timestamp, timezone).format("YYYY-MM-DD")),
    );
    // Historical days that are not yet cached, plus today (always refreshed).
    const missingDates = [
      ...neededDates.filter((d) => !cachedDateSet.has(d)),
      todayDate,
    ];

    const options = await this.getDefaultGetOptions();
    const newResults = await Promise.all(
      missingDates.map((date) =>
        this.fetchDayHistory(product, timezone, date, options),
      ),
    );
    const newPoints = newResults.flat();

    // Merge: keep existing points still within the window, append new ones.
    // Exclude today's stale cached points — they are replaced by the fresh fetch above.
    const cutoffDate = nowLocal
      .clone()
      .subtract(days, "days")
      .format("YYYY-MM-DD");
    const keptPoints = cachedPoints.filter((p) => {
      const date = moment.tz(p.timestamp, timezone).format("YYYY-MM-DD");
      return date > cutoffDate && date !== todayDate;
    });
    const allPoints = [...keptPoints, ...newPoints].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    // Log per-day summary for verification against the Tesla app.
    const solarHistLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    if (allPoints.length > 0) {
      const byDay = new Map<string, number>();
      for (const p of allPoints) {
        const day = moment.tz(p.timestamp, timezone).format("YYYY-MM-DD");
        byDay.set(day, (byDay.get(day) ?? 0) + p.solar_power / 1000 / 12); // 5-min intervals → kWh
      }
      solarHistLog.info(
        { daysLoaded: byDay.size, pointCount: allPoints.length },
        "Solar history loaded",
      );
    } else {
      solarHistLog.warn("Solar history unavailable — using linear fallback");
    }

    // Persist with a long TTL. refreshAfter is set to 10 minutes so today's partial
    // data (used for weather scaling) stays reasonably fresh throughout the day.
    // Past completed days are kept by the longer Redis TTL and skipped by cachedDateSet.
    const updatedCache = {
      refreshAfter: nowLocal.clone().add(10, "minutes").toISOString(),
      points: allPoints,
    };
    try {
      await redis.setex(
        cacheKey,
        (days + 2) * 24 * 3600,
        JSON.stringify(updatedCache),
      );
    } catch {
      // Redis write failed — non-fatal.
    }

    return allPoints;
  }

  async setBackupReserve(
    product: Product,
    value: string | number,
  ): Promise<void> {
    const percent = typeof value === "string" ? parseInt(value, 10) : value;
    if (percent < 0 && percent > 100) {
      throw new Error("Percent must be between 0 and 100.");
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/backup`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({
      backup_reserve_percent: percent,
    });
    if (process.env.DRY_RUN === "true") {
      siteLog.info(
        {
          dryRun: true,
          intent: `Set backup reserve to ${percent}%`,
          apiCall: {
            method: "POST",
            url: url.toString(),
            body: { backup_reserve_percent: percent },
          },
        },
        "[DRY RUN] Would set backup reserve",
      );
      return;
    }
    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, { ...options, body });
          if (!res.ok) {
            throw new Error(
              `Error setting Backup Reserve for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return res;
        },
        3,
        2000,
        2,
      );

      if (response.ok) {
        siteLog.info(
          {
            scheduleAction: "setBackupReserve",
            data: { percent } satisfies BackupReserveData,
          },
          "Backup reserve set",
        );
      } else {
        const errorText = await response.text();
        siteLog.error({ errorText }, "Failed to set backup reserve");
      }
    } catch (error: any) {
      const errorMsg = `Error setting backup reserve after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      siteLog.error(
        { err: error },
        "Error setting backup reserve after retries",
      );
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to set backup reserve for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
    }
  }

  async setSoftBackupReserve(
    product: Product,
    value: string | number,
  ): Promise<void> {
    const percent = typeof value === "string" ? parseInt(value, 10) : value;
    const liveStatus = await this.getLiveStatus(product);
    if (!liveStatus) {
      throw new Error(
        `Live status not available for Energy Site ${product.energy_site_id}.`,
      );
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    if (liveStatus.percentage_charged >= percent) {
      siteLog.info(
        {
          scheduleAction: "setSoftBackupReserve",
          data: {
            percent,
            currentSoc: liveStatus.percentage_charged,
            skipped: true,
          },
        },
        "Battery above soft reserve threshold — skipping",
      );
      return;
    }
    if (process.env.DRY_RUN === "true") {
      const url = new URL(
        `/api/1/energy_sites/${product.energy_site_id}/backup`,
        baseApiUrl,
      );
      siteLog.info(
        {
          dryRun: true,
          currentSoc: liveStatus.percentage_charged,
          intent: `Set soft backup reserve to ${percent}% (battery at ${liveStatus.percentage_charged}%, below threshold)`,
          apiCall: {
            method: "POST",
            url: url.toString(),
            body: { backup_reserve_percent: percent },
          },
        },
        "[DRY RUN] Would set soft backup reserve",
      );
      return;
    }
    await this.setBackupReserve(product, percent);
  }

  async setEnergyExports(product: Product, rule: string): Promise<void> {
    const ruleMap: Record<string, string> = {
      solarOnly: "pv_only",
      everything: "battery_ok",
    };
    const apiRule = ruleMap[rule];
    if (!apiRule) {
      throw new Error(`Unknown energy export rule: ${rule}`);
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/grid_import_export`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({ customer_preferred_export_rule: apiRule });
    if (process.env.DRY_RUN === "true") {
      siteLog.info(
        {
          dryRun: true,
          intent: `Set energy exports to ${rule} (${apiRule})`,
          apiCall: {
            method: "POST",
            url,
            body: { customer_preferred_export_rule: apiRule },
          },
        },
        "[DRY RUN] Would set energy exports",
      );
      return;
    }
    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, { ...options, body });
          if (!res.ok) {
            throw new Error(
              `Error setting energy exports for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return res;
        },
        3,
        2000,
        2,
      );
      if (response.ok) {
        siteLog.info(
          {
            scheduleAction: "setEnergyExports",
            data: { rule, apiRule } satisfies EnergyExportsData,
          },
          "Energy exports set",
        );
      } else {
        const errorText = await response.text();
        siteLog.error({ errorText }, "Failed to set energy exports");
      }
    } catch (error: any) {
      const errorMsg = `Error setting energy exports after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      siteLog.error(
        { err: error },
        "Error setting energy exports after retries",
      );
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to set energy exports for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
    }
  }

  private async getCalibration(
    siteId: string,
  ): Promise<(ISiteCalibration & IBasicEntity) | null> {
    const cached = calibrationCache.get(siteId);
    if (cached && performance.now() - cached.at < CALIBRATION_CACHE_TTL_MS) {
      return cached.data;
    }
    const db = await AppDataSource.getInstance(true);
    const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
      "SiteCalibration",
    );
    const record = await repo.findOne({
      where: {
        site_id: siteId,
        calibration_type: "grid_charge_rate",
      },
      order: { creation_time: "DESC" },
    });
    calibrationCache.set(siteId, {
      data: record ?? null,
      at: performance.now(),
    });
    return record ?? null;
  }

  private async getChargeCurve(
    siteId: string,
  ): Promise<ChargeCurveCalibrationData | null> {
    const cacheKey = `curve:${siteId}`;
    const cached = curveCache.get(cacheKey);
    if (cached && performance.now() - cached.at < CURVE_CACHE_TTL_MS) {
      return cached.data;
    }
    const db = await AppDataSource.getInstance(true);
    const repo = db.getRepository<ISiteCalibration & IBasicEntity>(
      "SiteCalibration",
    );
    const record = await repo.findOne({
      where: { site_id: siteId, calibration_type: "chargeCurve" },
      order: { creation_time: "DESC" },
    });
    const data = record
      ? (record.calibration_data as unknown as ChargeCurveCalibrationData)
      : null;
    curveCache.set(cacheKey, { data, at: performance.now() });
    return data;
  }

  private async recordChargeCurveSample(
    product: Product,
    liveStatus: LiveStatus,
  ): Promise<void> {
    const siteId = String(product.energy_site_id);
    const db = await AppDataSource.getInstance(true);
    const repo = db.getRepository<IBasicEntity & ISiteCalibrationSample>(
      "SiteCalibrationSample",
    );
    const now = new Date();
    await repo.save({
      site_id: siteId,
      calibration_type: "chargeCurve",
      creation_time: now,
      modified_time: now,
      sample_data: {
        soc_percent: Math.round(liveStatus.percentage_charged * 100) / 100,
        battery_kw: Math.round(Math.abs(liveStatus.battery_power) / 10) / 100,
        solar_kw: Math.round(liveStatus.solar_power / 10) / 100,
        grid_kw: Math.round(liveStatus.grid_power / 10) / 100,
      },
    } as IBasicEntity & ISiteCalibrationSample);
  }

  async setGridCharging(product: Product, setting: string): Promise<void> {
    const disallow = setting === "disabled";
    if (setting !== "enabled" && setting !== "disabled") {
      throw new Error(`Unknown grid charging setting: ${setting}`);
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/grid_import_export`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({
      disallow_charge_from_grid_with_solar_installed: disallow,
    });
    if (process.env.DRY_RUN === "true") {
      siteLog.info(
        {
          dryRun: true,
          intent: `Set grid charging to ${setting} (disallow=${disallow})`,
          apiCall: {
            method: "POST",
            url,
            body: { disallow_charge_from_grid_with_solar_installed: disallow },
          },
        },
        "[DRY RUN] Would set grid charging",
      );
      return;
    }
    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, { ...options, body });
          if (!res.ok) {
            throw new Error(
              `Error setting grid charging for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return res;
        },
        3,
        2000,
        2,
      );
      if (response.ok) {
        siteInfoCache.delete(product.energy_site_id);
        siteLog.info(
          {
            scheduleAction: "setGridCharging",
            data: { setting, disallow } satisfies GridChargingData,
          },
          "Grid charging set",
        );
      } else {
        const errorText = await response.text();
        siteLog.error({ errorText }, "Failed to set grid charging");
      }
    } catch (error: any) {
      const errorMsg = `Error setting grid charging after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      siteLog.error(
        { err: error },
        "Error setting grid charging after retries",
      );
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to set grid charging for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
    }
  }

  async setSmartGridCharging(
    product: Product,
    value: string,
    conditions: IScheduleCondition[] = [],
  ): Promise<SmartChargingData | null> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    let config: SmartChargingActionConfig;
    try {
      config = JSON.parse(value) as SmartChargingActionConfig;
    } catch {
      siteLog.error({ value }, "Smart charging: invalid config JSON");
      return null;
    }
    const solarEfficiencyFactor = config.solarEfficiencyFactor ?? 0.5;

    // siteInfo is cached (5-min TTL) so fetching it first is effectively free
    // after the first tick. timezone is needed for getSolarHistory.
    const siteInfo = await this.getSiteInfo(product);
    if (!siteInfo) {
      siteLog.warn("Smart charging: cannot run — site info unavailable");
      return null;
    }

    const timezone = siteInfo.installation_time_zone;
    const [liveStatus, solarHistory] = await Promise.all([
      this.getLiveStatus(product),
      this.getSolarHistory(product, timezone),
    ]);

    if (!liveStatus) {
      siteLog.warn("Smart charging: cannot run — live status unavailable");
      return null;
    }
    const now = moment().tz(timezone);
    const currentlyAllowed = !(
      siteInfo.components.disallow_charge_from_grid_with_solar_installed ??
      false
    );

    // PW3 reports capacity via nameplate_energy_watts on the lead gateway;
    // PW2 reports it via nameplate_energy on each battery pod.
    const totalEnergyKwh = calculateTotalCapacityKwh(siteInfo.components);
    if (totalEnergyKwh <= 0) {
      siteLog.warn(
        "Smart charging: battery capacity not available — skipping tick",
      );
      return null;
    }
    const energyNeededKwh = Math.max(
      0,
      ((config.targetSoc - liveStatus.percentage_charged) / 100) *
        totalEnergyKwh,
    );

    // Empty conditions means TOU mode with no time restriction (any time off-peak).
    const isTouMode =
      conditions.length === 0 ||
      conditions.some((c) => c.condition === "inSeasonalGridChargeWindow");
    const betweenHoursCond = conditions.find(
      (c) => c.condition === "betweenHours",
    );
    const holidayCond = conditions.find((c) => c.condition === "holidayList");
    const holidayEntries =
      (holidayCond?.value as HolidayEntry[] | undefined) ?? [];

    let desired: "enabled" | "disabled";
    let disableRequired = false;
    let reason: string;
    let solarForecast: SolarForecastResult | null = null;
    const chargeRateKw = calculateChargeRateKw(siteInfo.components);
    const calibration = await this.getCalibration(
      product.energy_site_id.toString(),
    );
    const calibrationData = calibration?.calibration_data as
      | IGridChargeRateCalibrationData
      | undefined;
    const effectiveChargeRateKw = calibrationData?.kw ?? chargeRateKw;
    const chargeRateSource: "calibrated" | "formula" =
      calibrationData?.kw !== undefined ? "calibrated" : "formula";

    const chargeCurve = await this.getChargeCurve(
      product.energy_site_id.toString(),
    );
    const chargeRateCurveSource: "lookup" | "defaults" = chargeCurve
      ? "lookup"
      : "defaults";

    if (liveStatus.battery_power < -500) {
      this.recordChargeCurveSample(product, liveStatus).catch(() => {});
    }

    if (isTouMode) {
      const tariff = parseTariffContent(siteInfo.tariff_content);
      if (!tariff) {
        siteLog.warn(
          "Smart charging: no TOU data — configure a TOU tariff in the Tesla app",
        );
        return null;
      }
      if (!hasTouData(tariff)) {
        // Tariff is present but has no on-peak periods — expected during a weekend
        // or holiday schedule override. Not a misconfiguration; smart charging is
        // simply not applicable when there is no peak to avoid.
        siteLog.info(
          { noOnPeakInTariff: true },
          "Smart charging: skipped — no on-peak periods in current tariff (weekend or holiday schedule active)",
        );
        return null;
      }

      if (isCurrentlyInPeak(tariff!, now)) {
        desired = "disabled";
        disableRequired = true;
        reason = "currently in on-peak period";
      } else if (energyNeededKwh <= 0) {
        desired = "disabled";
        reason = `target SOC already reached (${liveStatus.percentage_charged.toFixed(1)}%)`;
      } else {
        const nextPeakStart = findNextPeakStart(tariff!, now, holidayEntries);
        if (!nextPeakStart) {
          desired = "disabled";
          reason = "no upcoming peak found in tariff";
        } else {
          const effectivePeakStart = nextPeakStart
            .clone()
            .subtract(PEAK_BUFFER_MINUTES, "minutes");
          const minutesToPeak = Math.max(
            0,
            effectivePeakStart.diff(now, "minutes"),
          );
          const availableSolarKw = Math.max(
            0,
            (liveStatus.solar_power - liveStatus.load_power) / 1000,
          );
          const linearSolarKwh =
            availableSolarKw * (minutesToPeak / 60) * solarEfficiencyFactor;
          solarForecast = estimateSolarKwhFromHistory(
            solarHistory,
            now,
            effectivePeakStart,
            timezone,
          );
          const estimatedSolarKwh =
            solarForecast !== null
              ? solarForecast.estimatedKwh * SOLAR_FORECAST_DISCOUNT
              : linearSolarKwh;
          const solarLabel = buildSolarLabel(solarForecast, linearSolarKwh);

          // Only early-disable based on solar when the historical forecast is
          // available — the linear fallback is too imprecise to justify halting
          // grid charging on its own (it ignores the solar bell curve).
          if (solarForecast !== null && estimatedSolarKwh >= energyNeededKwh) {
            desired = "disabled";
            reason = `solar forecast to cover full ${energyNeededKwh.toFixed(2)}kWh needed (${solarLabel} — grid not needed)`;
          } else {
            const gridEnergyKwh = Math.max(
              0,
              energyNeededKwh - estimatedSolarKwh,
            );
            const { hours: gridChargeHours, effectiveRateKw } =
              calculateGridChargeHours(
                energyNeededKwh,
                estimatedSolarKwh,
                liveStatus.percentage_charged,
                config.targetSoc,
                effectiveChargeRateKw,
                chargeCurve ?? undefined,
              );
            const latestGridStart = effectivePeakStart
              .clone()
              .subtract(gridChargeHours, "hours");
            const nowIsAtOrAfterLatestStart = !now.isBefore(latestGridStart);

            let withinWindow = true;
            const windowCond = conditions.find(
              (c) => c.condition === "inSeasonalGridChargeWindow",
            );
            if (windowCond) {
              const windows = windowCond.value as SeasonalWindow[];
              const currentSeason = getCurrentSeason(tariff!, now);
              const seasonWindow = windows.find(
                (w) => w.seasonName === currentSeason?.name,
              );
              if (seasonWindow) {
                withinWindow = isWithinWindow(
                  seasonWindow.from,
                  seasonWindow.to,
                  now,
                );
              }
            }

            if (nowIsAtOrAfterLatestStart && withinWindow) {
              desired = "enabled";
              reason = `grid charging needed — ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW (${solarLabel}, peak at ${formatScheduledTime(nextPeakStart, now)})`;
            } else if (!nowIsAtOrAfterLatestStart) {
              desired = "disabled";
              reason = `waiting — grid will contribute ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW starting ${formatScheduledTime(latestGridStart, now)} (${solarLabel}, peak at ${formatScheduledTime(nextPeakStart, now)})`;
            } else {
              desired = "disabled";
              reason = `outside allowed window — grid start due at ${formatScheduledTime(latestGridStart, now)} but window is closed`;
            }
          }
        }
      }
    } else if (betweenHoursCond) {
      // Custom days mode: betweenHours.to is the charge-by deadline.
      const window = betweenHoursCond.value as { from: string; to: string };
      const [th, tm] = window.to.split(":").map(Number);
      let deadline = now
        .clone()
        .hours(th)
        .minutes(tm)
        .seconds(0)
        .milliseconds(0);
      if (!deadline.isAfter(now)) {
        deadline = deadline.add(1, "day");
      }

      if (!now.isBefore(deadline)) {
        desired = "disabled";
        disableRequired = true;
        reason = `past charge-by deadline ${window.to}`;
      } else if (energyNeededKwh <= 0) {
        desired = "disabled";
        reason = `target SOC already reached (${liveStatus.percentage_charged.toFixed(1)}%)`;
      } else {
        const effectiveDeadline = deadline
          .clone()
          .subtract(PEAK_BUFFER_MINUTES, "minutes");
        const minutesToDeadline = Math.max(
          0,
          effectiveDeadline.diff(now, "minutes"),
        );
        const availableSolarKw = Math.max(
          0,
          (liveStatus.solar_power - liveStatus.load_power) / 1000,
        );
        const linearSolarKwh =
          availableSolarKw * (minutesToDeadline / 60) * solarEfficiencyFactor;
        solarForecast = estimateSolarKwhFromHistory(
          solarHistory,
          now,
          effectiveDeadline,
          timezone,
        );
        const estimatedSolarKwh =
          solarForecast !== null
            ? solarForecast.estimatedKwh * SOLAR_FORECAST_DISCOUNT
            : linearSolarKwh;
        const solarLabel = buildSolarLabel(solarForecast, linearSolarKwh);

        // Only early-disable based on solar when the historical forecast is
        // available — the linear fallback is too imprecise to justify halting
        // grid charging on its own (it ignores the solar bell curve).
        if (solarForecast !== null && estimatedSolarKwh >= energyNeededKwh) {
          desired = "disabled";
          reason = `solar forecast to cover full ${energyNeededKwh.toFixed(2)}kWh needed (${solarLabel} — grid not needed)`;
        } else {
          const gridEnergyKwh = Math.max(
            0,
            energyNeededKwh - estimatedSolarKwh,
          );
          const { hours: gridChargeHours, effectiveRateKw } =
            calculateGridChargeHours(
              energyNeededKwh,
              estimatedSolarKwh,
              liveStatus.percentage_charged,
              config.targetSoc,
              effectiveChargeRateKw,
              chargeCurve ?? undefined,
            );
          const latestGridStart = effectiveDeadline
            .clone()
            .subtract(gridChargeHours, "hours");
          const nowIsAtOrAfterLatestStart = !now.isBefore(latestGridStart);
          const withinWindow = isWithinWindow(window.from, window.to, now);

          if (nowIsAtOrAfterLatestStart && withinWindow) {
            desired = "enabled";
            reason = `grid charging needed — ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW (${solarLabel}, deadline ${window.to})`;
          } else if (!nowIsAtOrAfterLatestStart) {
            desired = "disabled";
            reason = `waiting — grid will contribute ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW starting ${formatScheduledTime(latestGridStart, now)} (${solarLabel}, deadline ${window.to})`;
          } else {
            desired = "disabled";
            reason = `outside allowed window — grid start due at ${formatScheduledTime(latestGridStart, now)} but window is closed`;
          }
        }
      }
    } else {
      siteLog.warn("Smart charging: no recognised condition — skipping");
      return null;
    }

    const forecastMethod =
      solarForecast !== null ? "historical" : "linear-fallback";
    const estimatedSolarKwh = solarForecast
      ? Math.round(solarForecast.estimatedKwh * 100) / 100
      : null;
    const weatherFactor = solarForecast
      ? Math.round(solarForecast.scalingFactor * 100) / 100
      : null;
    siteLog.debug(
      {
        forecastMethod,
        data: {
          estimatedSolarKwh,
          weatherFactor,
          daysUsed: solarForecast?.daysUsed ?? null,
          scalingFactor: solarForecast?.scalingFactor ?? null,
        },
      },
      "Solar forecast computed",
    );
    const current: "enabled" | "disabled" = currentlyAllowed
      ? "enabled"
      : "disabled";

    let action: "enabled" | "disabled" | "no_change";
    if (desired === "enabled" && !currentlyAllowed) {
      if (process.env.DRY_RUN !== "true")
        await this.setGridCharging(product, "enabled");
      action = "enabled";
    } else if (desired === "disabled" && disableRequired && currentlyAllowed) {
      if (process.env.DRY_RUN !== "true")
        await this.setGridCharging(product, "disabled");
      action = "disabled";
    } else {
      action = "no_change";
    }

    return {
      desired,
      current,
      action,
      soc: liveStatus.percentage_charged,
      targetSoc: config.targetSoc,
      forecastMethod,
      estimatedSolarKwh,
      weatherFactor,
      batteryChargeRateFromGridKw: (() => {
        const batteryChargingW =
          liveStatus.battery_power < 0 ? -liveStatus.battery_power : 0;
        if (batteryChargingW === 0) return null;
        // Grid covers home load first; solar covers whatever remains.
        // Only battery charging beyond that solar surplus came from grid.
        const gridImportW = Math.max(0, liveStatus.grid_power);
        const homeAfterGridW = Math.max(0, liveStatus.load_power - gridImportW);
        const solarSurplusW = Math.max(
          0,
          liveStatus.solar_power - homeAfterGridW,
        );
        return (
          Math.round(Math.max(0, batteryChargingW - solarSurplusW) / 10) / 100
        );
      })(),
      liveKw: {
        solar: Math.round(liveStatus.solar_power / 10) / 100,
        load: Math.round(liveStatus.load_power / 10) / 100,
        grid: Math.round(liveStatus.grid_power / 10) / 100,
        battery: Math.round(liveStatus.battery_power / 10) / 100,
      },
      chargeRateKw: Math.round(effectiveChargeRateKw * 100) / 100,
      chargeRateSource,
      chargeRateCurveSource,
      reason,
    };
  }

  private buildWeekendTariff(tariff: Record<string, any>): Record<string, any> {
    const VALID_LABELS = new Set([
      "ON_PEAK",
      "OFF_PEAK",
      "PARTIAL_PEAK",
      "SUPER_OFF_PEAK",
    ]);

    function processSeasons(seasons: Record<string, any>): Record<string, any> {
      const result: Record<string, any> = {};
      for (const [seasonName, season] of Object.entries(seasons)) {
        const originalPeriods: Record<string, any> =
          (season as any).tou_periods ?? {};
        const newPeriods: Record<string, any> = {};
        for (const label of Object.keys(originalPeriods)) {
          if (!VALID_LABELS.has(label)) continue;
          const labelData = originalPeriods[label];
          const periods: any[] = Array.isArray(labelData)
            ? labelData
            : (labelData?.periods ?? []);
          // Keep only periods that reach weekend days (Sat=5 or Sun=6)
          const weekendPeriods = periods.filter(
            (p: any) => (p.toDayOfWeek ?? 6) >= 5,
          );
          if (weekendPeriods.length === 0) continue;
          // Apply weekend schedule to both weekday (0–4) and weekend (5–6) as
          // separate blocks so the Tesla App and our UI can display them correctly.
          const weekdayVersions = weekendPeriods.map((p: any) => ({
            ...p,
            fromDayOfWeek: 0,
            toDayOfWeek: 4,
          }));
          const weekendVersions = weekendPeriods.map((p: any) => ({
            ...p,
            fromDayOfWeek: 5,
            toDayOfWeek: 6,
          }));
          const combined = [...weekdayVersions, ...weekendVersions];
          newPeriods[label] = Array.isArray(labelData)
            ? combined
            : { ...labelData, periods: combined };
        }
        result[seasonName] = { ...(season as any), tou_periods: newPeriods };
      }
      return result;
    }

    const modified = { ...tariff };
    if (tariff.seasons && typeof tariff.seasons === "object") {
      modified.seasons = processSeasons(tariff.seasons);
    }
    if (
      tariff.sell_tariff?.seasons &&
      typeof tariff.sell_tariff.seasons === "object"
    ) {
      modified.sell_tariff = {
        ...tariff.sell_tariff,
        seasons: processSeasons(tariff.sell_tariff.seasons),
      };
    }
    return modified;
  }

  private async applyHolidayTou(
    product: Product,
    tariffV2: Record<string, any>,
  ): Promise<void> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const now = new Date();
    const db = await AppDataSource.getInstance();
    const repo = db.getRepository("TouBackup");

    // Save the current tariff as backup before overriding
    await repo.save({
      id: uuidv4(),
      creation_time: now,
      modified_time: now,
      email: this.email,
      site_id: String(product.energy_site_id),
      tariff_content_v2: tariffV2,
    } satisfies ITouBackup);

    const modified = this.buildWeekendTariff(tariffV2);
    await this.postTouSettings(product, modified);
    siteLog.info("Holiday TOU override applied");
  }

  private async restoreTou(product: Product): Promise<void> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const db = await AppDataSource.getInstance();
    const repo = db.getRepository("TouBackup");
    const backup = await repo.findOne({
      where: {
        email: this.email,
        site_id: String(product.energy_site_id),
      },
      order: { creation_time: "DESC" },
    });

    if (!backup) {
      siteLog.warn("No TOU backup found — skipping restore");
      return;
    }

    await this.postTouSettings(
      product,
      (backup as ITouBackup).tariff_content_v2,
    );
    siteLog.info("TOU restored from backup");

    // Delete the used backup row
    await repo.delete({ id: (backup as any).id });

    // Stale cleanup: remove any orphaned backups older than 3 days for this email
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await repo
      .createQueryBuilder()
      .delete()
      .where("email = :email AND creation_time < :cutoff", {
        email: this.email,
        cutoff,
      })
      .execute();
  }

  private async postTouSettings(
    product: Product,
    tariffV2: Record<string, any>,
  ): Promise<void> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/time_of_use_settings`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({
      tou_settings: {
        optimization_strategy: "economics",
        tariff_content_v2: tariffV2,
      },
    });
    if (process.env.DRY_RUN === "true") {
      siteLog.info(
        { dryRun: true, intent: "POST time_of_use_settings" },
        "[DRY RUN] Would POST TOU settings",
      );
      siteLog.debug({ tariff_content_v2: tariffV2 }, "[DRY RUN] TOU payload");
      return;
    }
    await retry(
      async () => {
        const res = await fetch(url, { ...options, body });
        if (!res.ok) {
          throw new Error(
            `Error posting TOU settings for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
          );
        }
        return res;
      },
      3,
      2000,
      2,
    );
  }

  async setTouHolidayOverride(
    product: Product,
    _value: string,
    conditions: IScheduleCondition[],
  ): Promise<TouHolidayData> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const holidayCond = conditions.find((c) => c.condition === "holidayList");
    const entries = (holidayCond?.value as HolidayEntry[] | undefined) ?? [];

    const siteInfo = await this.getSiteInfo(product);
    const tz = siteInfo?.installation_time_zone ?? "UTC";
    const now = moment().tz(tz);
    const today = now.format("YYYY-MM-DD");
    const yesterday = now.clone().subtract(1, "day").format("YYYY-MM-DD");

    const tariffV2: Record<string, any> | undefined =
      siteInfo?.tariff_content_v2;

    if (isObservedHolidayOnDate(entries, today)) {
      siteLog.info(
        {
          scheduleAction: "setTouHolidayOverride",
          data: { today, holidayAction: "override" } satisfies TouHolidayData,
        },
        "Holiday TOU override triggered",
      );
      if (!tariffV2) {
        siteLog.warn(
          "No tariff_content_v2 available — cannot apply holiday TOU override",
        );
        return { today, holidayAction: "none" };
      }
      await this.applyHolidayTou(product, tariffV2);
      return { today, holidayAction: "override" };
    } else if (isObservedHolidayOnDate(entries, yesterday)) {
      siteLog.info(
        {
          scheduleAction: "setTouHolidayOverride",
          data: { today, holidayAction: "restore" } satisfies TouHolidayData,
        },
        "Day after holiday — restoring TOU",
      );
      await this.restoreTou(product);
      return { today, holidayAction: "restore" };
    } else {
      siteLog.debug(
        {
          scheduleAction: "setTouHolidayOverride",
          data: { today, holidayAction: "none" } satisfies TouHolidayData,
        },
        "No holiday action needed",
      );
      return { today, holidayAction: "none" };
    }
  }

  async setOperationalMode(product: Product, mode: string): Promise<void> {
    const modeMap: Record<string, string> = {
      selfPowered: "self_consumption",
      timeBasedControl: "autonomous",
    };
    const apiMode = modeMap[mode];
    if (!apiMode) {
      throw new Error(`Unknown operational mode: ${mode}`);
    }
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/operation`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({ default_real_mode: apiMode });
    if (process.env.DRY_RUN === "true") {
      siteLog.info(
        {
          dryRun: true,
          intent: `Set operational mode to ${mode} (${apiMode})`,
          apiCall: {
            method: "POST",
            url,
            body: { default_real_mode: apiMode },
          },
        },
        "[DRY RUN] Would set operational mode",
      );
      return;
    }
    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, { ...options, body });
          if (!res.ok) {
            throw new Error(
              `Error setting operational mode for Energy Site ${product.energy_site_id}: ${res.status} ${res.statusText}`,
            );
          }
          return res;
        },
        3,
        2000,
        2,
      );
      if (response.ok) {
        siteLog.info(
          {
            scheduleAction: "setOperationalMode",
            data: { mode, apiMode } satisfies OperationalModeData,
          },
          "Operational mode set",
        );
      } else {
        const errorText = await response.text();
        siteLog.error({ errorText }, "Failed to set operational mode");
      }
    } catch (error: any) {
      const errorMsg = `Error setting operational mode after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      siteLog.error(
        { err: error },
        "Error setting operational mode after retries",
      );
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Failed to set operational mode for Energy Site ${product.energy_site_id}. Please check the server logs.`,
        this.email,
        this.options.mailOnError,
      );
      if (this.options.throwOnError) {
        throw new Error(errorMsg, { cause: error });
      }
    }
  }

  async setTouSchedule(
    product: Product,
    tariffV2: Record<string, any>,
  ): Promise<void> {
    const siteLog = this.log.child({
      siteId: String(product.energy_site_id),
      siteName: product.site_name,
    });
    await this.postTouSettings(product, tariffV2);
    siteInfoCache.delete(product.energy_site_id);
    siteLog.info("TOU schedule applied");
  }

  async detectCalibration(product: Product): Promise<void> {
    const live = await this.getLiveStatus(product);
    if (!live) return;

    const bmsCalibrating = isCalibrating(live);
    const siteId = String(product.energy_site_id);
    const siteName = product.site_name ?? `Site ${product.energy_site_id}`;
    const siteLog = this.log.child({ siteId, siteName });

    // Update discharge ring buffer with the latest battery_power reading.
    const buf = dischargeBuffer.get(product.energy_site_id) ?? [];
    buf.push(live.battery_power);
    if (buf.length > DISCHARGE_BUFFER_SIZE) buf.shift();
    dischargeBuffer.set(product.energy_site_id, buf);

    const bufferFull = buf.length >= DISCHARGE_BUFFER_SIZE;
    const isOnGrid =
      live.island_status === "on_grid" && !live.storm_mode_active;
    const dischargeCalibrating =
      bufferFull && isOnGrid && buf.every((p) => p > DISCHARGE_MIN_POWER_W);

    if (process.env.DRY_RUN === "true") {
      if (bmsCalibrating) {
        siteLog.info(
          { dryRun: true, eventType: "calibration_bms_lock" },
          "[DRY RUN] BMS calibration detected — no DB write or email",
        );
      }
      if (dischargeCalibrating) {
        siteLog.info(
          {
            dryRun: true,
            eventType: "calibration_discharge",
            bufferSize: DISCHARGE_BUFFER_SIZE,
            minPowerW: DISCHARGE_MIN_POWER_W,
          },
          "[DRY RUN] Discharge calibration detected — no DB write or email",
        );
      }
      return;
    }

    const db = await AppDataSource.getInstance();
    const repo = db.getRepository<ISiteEvent>("SiteEvent");

    await this.handleSiteEvent(
      repo,
      siteId,
      siteName,
      "calibration_bms_lock",
      bmsCalibrating,
      `Powerwall calibration started — ${siteName}`,
      `A battery calibration cycle has been detected on "${siteName}".\n\nThe battery will report 0% SOC until the cycle completes. No action is required.`,
      `Powerwall calibration complete — ${siteName}`,
      `The battery calibration cycle on "${siteName}" has finished.\n\nNormal operation has resumed.`,
    );

    // Skip discharge detection until the buffer has enough readings (e.g. after
    // a server restart) to avoid prematurely closing a stale open event.
    if (!bufferFull) {
      siteLog.debug(
        { bufferLength: buf.length, bufferSize: DISCHARGE_BUFFER_SIZE },
        "Discharge buffer filling",
      );
      return;
    }

    dischargeCalibrationActive.set(
      product.energy_site_id,
      dischargeCalibrating,
    );

    await this.handleSiteEvent(
      repo,
      siteId,
      siteName,
      "calibration_discharge",
      dischargeCalibrating,
      `Powerwall discharge calibration detected — ${siteName}`,
      `A sustained battery discharge has been detected on "${siteName}" during what should be an idle period.\n\nThe battery has been actively discharging for ${DISCHARGE_BUFFER_SIZE}+ consecutive minutes above ${DISCHARGE_MIN_POWER_W}W. This may indicate a calibration discharge cycle.\n\nNo action is required unless this is unexpected.`,
      `Powerwall discharge calibration complete — ${siteName}`,
      `The sustained battery discharge on "${siteName}" has stopped.\n\nNormal standby operation has resumed.`,
    );
  }

  private async handleSiteEvent(
    repo: ReturnType<
      Awaited<ReturnType<typeof AppDataSource.getInstance>>["getRepository"]
    >,
    siteId: string,
    siteName: string,
    eventType: SiteEventType,
    active: boolean,
    startSubject: string,
    startBody: string,
    endSubject: string,
    endBody: string,
  ): Promise<void> {
    const siteLog = this.log.child({ siteId, siteName });
    const openEvent = await repo.findOne({
      where: {
        site_id: siteId,
        event_payload: IsNull(),
        event_type: eventType,
      },
    });

    if (active && !openEvent) {
      const now = new Date();
      await repo.save({
        id: uuidv4(),
        creation_time: now,
        modified_time: now,
        site_id: siteId,
        site_name: siteName,
        event_type: eventType,
        event_payload: null,
      } satisfies ISiteEvent);
      siteLog.info({ eventType }, "Site event started");
      await sendEmail(
        startSubject,
        startBody,
        this.email,
        this.options.mailOnError,
      );
    } else if (!active && openEvent) {
      const now = new Date();
      await repo.update(openEvent.id!, {
        modified_time: now,
        event_payload: { ended_at: now.toISOString() },
      });
      siteLog.info({ eventType }, "Site event completed");
      await sendEmail(
        endSubject,
        endBody,
        this.email,
        this.options.mailOnError,
      );
    }
  }
}
