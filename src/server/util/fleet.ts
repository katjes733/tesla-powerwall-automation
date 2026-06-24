import { jwtDecode } from "jwt-decode";
import moment from "moment-timezone";
import type {
  FleetOptions,
  FleetOptionsInput,
  JWT,
  LiveStatus,
  Product,
  RefreshTokenData,
  SiteInfo,
  SmartChargingActionConfig,
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
  type SolarForecastResult,
} from "~/server/util/solarForecast";

export interface SmartChargingLogResult {
  site: string;
  energySiteId: number;
  desired: "enabled" | "disabled";
  current: "enabled" | "disabled";
  action: "enabled" | "disabled" | "no_change";
  soc: number;
  targetSoc: number;
  forecastMethod: "historical" | "linear-fallback";
  estimatedSolarKwh: number | null;
  weatherFactor: number | null;
  batteryChargeRateFromGridKw: number | null;
  reason: string;
}

const SITE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const siteInfoCache = new Map<number, { info: SiteInfo; at: number }>();

const LIVE_STATUS_CACHE_TTL_MS = 30 * 1000;
const liveStatusCache = new Map<number, { status: LiveStatus; at: number }>();

// Ring buffer: last N battery_power readings per site (one per minute from cron).
// Used to detect a sustained discharge during what should be an idle period.
const DISCHARGE_BUFFER_SIZE = 10;
const DISCHARGE_MIN_POWER_W = 300;
const dischargeBuffer = new Map<number, number[]>();
const dischargeCalibrationActive = new Map<number, boolean>();

export function isDischargeCalibrating(siteId: number): boolean {
  return dischargeCalibrationActive.get(siteId) ?? false;
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

  private energyProducts: Product[] = [];
  private _actionMap: Record<string, Function>;

  private constructor(email: string, options?: FleetOptionsInput) {
    this.email = email;
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

  async getToken() {
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

    const tokenResponse = await getNewTokenWithRefreshToken(this.refreshToken);
    if (!tokenResponse.ok) {
      const errorMsg = `Failed to obtain new token with refresh token: ${tokenResponse.status} ${tokenResponse.statusText}`;
      logger.error(errorMsg);
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

    logger.info("New token obtained and stored successfully.");

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
      logger.error(errorMsg);
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
      logger.error(errorMsg);
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
      logger.error(errorMsg);
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
  ): Promise<SolarPowerDataPoint[]> {
    // Avoid 00:00:00 — the API returns empty data at midnight.
    const endDate = moment
      .tz(`${dateStr} 23:45`, "YYYY-MM-DD HH:mm", timezone)
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
      return (response.time_series ?? []) as SolarPowerDataPoint[];
    } catch (error: any) {
      logger.warn(
        `[solar history] fetch for ${dateStr} failed: ${error.message}`,
      );
      return [];
    }
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
    if (allPoints.length > 0) {
      const byDay = new Map<string, number>();
      for (const p of allPoints) {
        const day = moment.tz(p.timestamp, timezone).format("YYYY-MM-DD");
        byDay.set(day, (byDay.get(day) ?? 0) + p.solar_power / 1000 / 12); // 5-min intervals → kWh
      }
      const summary = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, kwh]) => `${d}: ${kwh.toFixed(2)}kWh`)
        .join(", ");
      logger.info(
        `[solar history] ${allPoints.length} points across ${byDay.size} days — ${summary}`,
      );
    } else {
      logger.warn(
        `Smart charging: solar history unavailable for site "${product.site_name}"; using linear fallback`,
      );
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
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/backup`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({
      backup_reserve_percent: percent,
    });
    if (process.env.DRY_RUN === "true") {
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          intent: `Set backup reserve to ${percent}%`,
          apiCall: {
            method: "POST",
            url: url.toString(),
            body: { backup_reserve_percent: percent },
          },
        },
        `[DRY RUN] Would set backup reserve to ${percent}% for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
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
        logger.info(
          `Backup reserve set to ${percent}% successfully for Energy Site ${product.energy_site_id}.`,
        );
      } else {
        const errorText = await response.text();
        logger.error(
          `Failed to set backup reserve for Energy Site ${product.energy_site_id}: ${errorText}`,
        );
      }
    } catch (error: any) {
      const errorMsg = `Error setting backup reserve after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      logger.error(errorMsg);
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
    if (liveStatus.percentage_charged >= percent) {
      logger.info(
        `Battery level is ${liveStatus.percentage_charged}%, which is already above the soft backup reserve of ${percent}%. Not setting soft backup reserve.`,
      );
      return;
    }
    if (process.env.DRY_RUN === "true") {
      const url = new URL(
        `/api/1/energy_sites/${product.energy_site_id}/backup`,
        baseApiUrl,
      );
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          currentChargePercent: liveStatus.percentage_charged,
          intent: `Set soft backup reserve to ${percent}% (battery at ${liveStatus.percentage_charged}%, below threshold)`,
          apiCall: {
            method: "POST",
            url: url.toString(),
            body: { backup_reserve_percent: percent },
          },
        },
        `[DRY RUN] Would set backup reserve to ${percent}% for site "${product.site_name}" — battery is at ${liveStatus.percentage_charged}% (below ${percent}% threshold)`,
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
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/grid_import_export`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({ customer_preferred_export_rule: apiRule });
    if (process.env.DRY_RUN === "true") {
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          intent: `Set energy exports to ${rule} (${apiRule})`,
          apiCall: {
            method: "POST",
            url,
            body: { customer_preferred_export_rule: apiRule },
          },
        },
        `[DRY RUN] Would set energy exports to "${rule}" (${apiRule}) for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
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
        logger.info(
          `Energy exports set to "${rule}" (${apiRule}) successfully for Energy Site ${product.energy_site_id}.`,
        );
      } else {
        const errorText = await response.text();
        logger.error(
          `Failed to set energy exports for Energy Site ${product.energy_site_id}: ${errorText}`,
        );
      }
    } catch (error: any) {
      const errorMsg = `Error setting energy exports after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      logger.error(errorMsg);
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

  async setGridCharging(product: Product, setting: string): Promise<void> {
    const disallow = setting === "disabled";
    if (setting !== "enabled" && setting !== "disabled") {
      throw new Error(`Unknown grid charging setting: ${setting}`);
    }
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/grid_import_export`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({
      disallow_charge_from_grid_with_solar_installed: disallow,
    });
    if (process.env.DRY_RUN === "true") {
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          intent: `Set grid charging to ${setting} (disallow=${disallow})`,
          apiCall: {
            method: "POST",
            url,
            body: { disallow_charge_from_grid_with_solar_installed: disallow },
          },
        },
        `[DRY RUN] Would set grid charging to "${setting}" (disallow=${disallow}) for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
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
        logger.info(
          `Grid charging set to "${setting}" (disallow=${disallow}) successfully for Energy Site ${product.energy_site_id}.`,
        );
      } else {
        const errorText = await response.text();
        logger.error(
          `Failed to set grid charging for Energy Site ${product.energy_site_id}: ${errorText}`,
        );
      }
    } catch (error: any) {
      const errorMsg = `Error setting grid charging after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      logger.error(errorMsg);
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
  ): Promise<SmartChargingLogResult | null> {
    let config: SmartChargingActionConfig;
    try {
      config = JSON.parse(value) as SmartChargingActionConfig;
    } catch {
      logger.error(
        `Smart charging: invalid config JSON for site "${product.site_name}": ${value}`,
      );
      return null;
    }
    const solarEfficiencyFactor = config.solarEfficiencyFactor ?? 0.5;

    // siteInfo is cached (5-min TTL) so fetching it first is effectively free
    // after the first tick. timezone is needed for getSolarHistory.
    const siteInfo = await this.getSiteInfo(product);
    if (!siteInfo) {
      logger.warn(
        `Smart charging: cannot run — site info unavailable for site "${product.site_name}"`,
      );
      return null;
    }

    const timezone = siteInfo.installation_time_zone;
    const [liveStatus, solarHistory] = await Promise.all([
      this.getLiveStatus(product),
      this.getSolarHistory(product, timezone),
    ]);

    if (!liveStatus) {
      logger.warn(
        `Smart charging: cannot run — live status unavailable for site "${product.site_name}"`,
      );
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
      logger.warn(
        `Smart charging: battery capacity not available for site "${product.site_name}" — skipping tick`,
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

    let desired: "enabled" | "disabled";
    let reason: string;
    let solarForecast: SolarForecastResult | null = null;

    if (isTouMode) {
      const tariff = parseTariffContent(siteInfo.tariff_content);
      if (!hasTouData(tariff)) {
        logger.warn(
          `Smart charging: no TOU data for site "${product.site_name}" — configure a TOU tariff in the Tesla app`,
        );
        return null;
      }

      if (isCurrentlyInPeak(tariff!, now)) {
        desired = "disabled";
        reason = "currently in on-peak period";
      } else if (energyNeededKwh <= 0) {
        desired = "disabled";
        reason = `target SOC already reached (${liveStatus.percentage_charged.toFixed(1)}%)`;
      } else {
        const nextPeakStart = findNextPeakStart(tariff!, now);
        if (!nextPeakStart) {
          desired = "disabled";
          reason = "no upcoming peak found in tariff";
        } else {
          const minutesToPeak = nextPeakStart.diff(now, "minutes");
          const chargeRateKw = calculateChargeRateKw(siteInfo.components);
          const availableSolarKw = Math.max(
            0,
            (liveStatus.solar_power - liveStatus.load_power) / 1000,
          );
          const linearSolarKwh =
            availableSolarKw * (minutesToPeak / 60) * solarEfficiencyFactor;
          solarForecast = estimateSolarKwhFromHistory(
            solarHistory,
            now,
            nextPeakStart,
            timezone,
          );
          const estimatedSolarKwh =
            solarForecast !== null
              ? solarForecast.estimatedKwh
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
                chargeRateKw,
              );
            const latestGridStart = nextPeakStart
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
              reason = `grid charging needed — ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW (${solarLabel}, peak at ${nextPeakStart.format("HH:mm")})`;
            } else if (!nowIsAtOrAfterLatestStart) {
              desired = "disabled";
              reason = `waiting — grid will contribute ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW starting ${latestGridStart.format("HH:mm")} (${solarLabel}, peak at ${nextPeakStart.format("HH:mm")})`;
            } else {
              desired = "disabled";
              reason = `outside allowed window — grid start due at ${latestGridStart.format("HH:mm")} but window is closed`;
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
        reason = `past charge-by deadline ${window.to}`;
      } else if (energyNeededKwh <= 0) {
        desired = "disabled";
        reason = `target SOC already reached (${liveStatus.percentage_charged.toFixed(1)}%)`;
      } else {
        const minutesToDeadline = deadline.diff(now, "minutes");
        const chargeRateKw = calculateChargeRateKw(siteInfo.components);
        const availableSolarKw = Math.max(
          0,
          (liveStatus.solar_power - liveStatus.load_power) / 1000,
        );
        const linearSolarKwh =
          availableSolarKw * (minutesToDeadline / 60) * solarEfficiencyFactor;
        solarForecast = estimateSolarKwhFromHistory(
          solarHistory,
          now,
          deadline,
          timezone,
        );
        const estimatedSolarKwh =
          solarForecast !== null ? solarForecast.estimatedKwh : linearSolarKwh;
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
              chargeRateKw,
            );
          const latestGridStart = deadline
            .clone()
            .subtract(gridChargeHours, "hours");
          const nowIsAtOrAfterLatestStart = !now.isBefore(latestGridStart);
          const withinWindow = isWithinWindow(window.from, window.to, now);

          if (nowIsAtOrAfterLatestStart && withinWindow) {
            desired = "enabled";
            reason = `grid charging needed — ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW (${solarLabel}, deadline ${window.to})`;
          } else if (!nowIsAtOrAfterLatestStart) {
            desired = "disabled";
            reason = `waiting — grid will contribute ${gridEnergyKwh.toFixed(2)}kWh at ${effectiveRateKw}kW starting ${latestGridStart.format("HH:mm")} (${solarLabel}, deadline ${window.to})`;
          } else {
            desired = "disabled";
            reason = `outside allowed window — grid start due at ${latestGridStart.format("HH:mm")} but window is closed`;
          }
        }
      }
    } else {
      logger.warn(
        `Smart charging: no recognised condition for site "${product.site_name}" — skipping`,
      );
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
    const current: "enabled" | "disabled" = currentlyAllowed
      ? "enabled"
      : "disabled";

    let action: "enabled" | "disabled" | "no_change";
    if (desired === "enabled" && !currentlyAllowed) {
      if (process.env.DRY_RUN !== "true")
        await this.setGridCharging(product, "enabled");
      action = "enabled";
    } else if (desired === "disabled" && currentlyAllowed) {
      if (process.env.DRY_RUN !== "true")
        await this.setGridCharging(product, "disabled");
      action = "disabled";
    } else {
      action = "no_change";
    }

    return {
      site: product.site_name,
      energySiteId: product.energy_site_id,
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
        const solarSurplusW = Math.max(
          0,
          liveStatus.solar_power - liveStatus.load_power,
        );
        return (
          Math.round(Math.max(0, batteryChargingW - solarSurplusW) / 10) / 100
        );
      })(),
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
          // Keep only periods that reach weekend days (Sat=6 or Sun=0)
          const weekendPeriods = periods.filter(
            (p: any) => (p.toDayOfWeek ?? 6) >= 5,
          );
          if (weekendPeriods.length === 0) continue;
          // Expand each kept period to all days
          const expandedPeriods = weekendPeriods.map((p: any) => ({
            ...p,
            fromDayOfWeek: 0,
            toDayOfWeek: 6,
          }));
          newPeriods[label] = Array.isArray(labelData)
            ? expandedPeriods
            : { ...labelData, periods: expandedPeriods };
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
    logger.info(
      `Holiday TOU override applied for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
    );
  }

  private async restoreTou(product: Product): Promise<void> {
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
      logger.warn(
        `No TOU backup found for site "${product.site_name}" (energy_site_id: ${product.energy_site_id}) — skipping restore`,
      );
      return;
    }

    await this.postTouSettings(
      product,
      (backup as ITouBackup).tariff_content_v2,
    );
    logger.info(
      `TOU restored from backup for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
    );

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
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          intent: "POST time_of_use_settings",
        },
        `[DRY RUN] Would POST TOU settings for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
      );
      logger.debug(
        { tariff_content_v2: tariffV2 },
        `[DRY RUN] TOU payload for site "${product.site_name}"`,
      );
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
  ): Promise<void> {
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
      logger.info(
        `Holiday on ${today} for site "${product.site_name}" — overriding TOU to weekend schedule`,
      );
      if (!tariffV2) {
        logger.warn(
          `No tariff_content_v2 available for site "${product.site_name}" — cannot apply holiday TOU override`,
        );
        return;
      }
      await this.applyHolidayTou(product, tariffV2);
    } else if (isObservedHolidayOnDate(entries, yesterday)) {
      logger.info(
        `Day after holiday (${yesterday}) for site "${product.site_name}" — restoring original TOU`,
      );
      await this.restoreTou(product);
    } else {
      logger.debug(
        `No holiday action needed for ${today} on site "${product.site_name}"`,
      );
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
    const url = new URL(
      `/api/1/energy_sites/${product.energy_site_id}/operation`,
      baseApiUrl,
    ).toString();
    const options = await this.getDefaultPostOptions();
    const body = JSON.stringify({ default_real_mode: apiMode });
    if (process.env.DRY_RUN === "true") {
      logger.info(
        {
          dryRun: true,
          site: product.site_name,
          energySiteId: product.energy_site_id,
          intent: `Set operational mode to ${mode} (${apiMode})`,
          apiCall: {
            method: "POST",
            url,
            body: { default_real_mode: apiMode },
          },
        },
        `[DRY RUN] Would set operational mode to "${mode}" (${apiMode}) for site "${product.site_name}" (energy_site_id: ${product.energy_site_id})`,
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
        logger.info(
          `Operational mode set to "${mode}" (${apiMode}) successfully for Energy Site ${product.energy_site_id}.`,
        );
      } else {
        const errorText = await response.text();
        logger.error(
          `Failed to set operational mode for Energy Site ${product.energy_site_id}: ${errorText}`,
        );
      }
    } catch (error: any) {
      const errorMsg = `Error setting operational mode after retries for Energy Site ${product.energy_site_id}: ${error.message}`;
      logger.error(errorMsg);
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

  async detectCalibration(product: Product): Promise<void> {
    const live = await this.getLiveStatus(product);
    if (!live) return;

    const bmsCalibrating = isCalibrating(live);
    const siteId = String(product.energy_site_id);
    const siteName = product.site_name ?? `Site ${product.energy_site_id}`;

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
        logger.info(
          `[DRY RUN] BMS calibration detected for site "${siteName}" — no DB write or email`,
        );
      }
      if (dischargeCalibrating) {
        logger.info(
          `[DRY RUN] Discharge calibration detected for site "${siteName}" (${DISCHARGE_BUFFER_SIZE} consecutive readings >${DISCHARGE_MIN_POWER_W}W) — no DB write or email`,
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
      logger.debug(
        `Discharge buffer filling for site "${siteName}" (${buf.length}/${DISCHARGE_BUFFER_SIZE})`,
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
    const openEvent = await repo.findOne({
      where: {
        email: this.email,
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
        email: this.email,
        site_id: siteId,
        site_name: siteName,
        event_type: eventType,
        event_payload: null,
      } satisfies ISiteEvent);
      logger.info(`${eventType} event started for site "${siteName}"`);
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
      logger.info(`${eventType} event completed for site "${siteName}"`);
      await sendEmail(
        endSubject,
        endBody,
        this.email,
        this.options.mailOnError,
      );
    }
  }
}
