import { jwtDecode } from "jwt-decode";
import type {
  JWT,
  LiveStatus,
  Product,
  SiteInfo,
  TokenData,
} from "~/types/common";
import { getNewTokenWithRefreshToken } from "~/util/auth";
import { setEnvVar } from "~/util/env";
import { retry } from "~/util/retry";
import { sendEmail } from "./mailing";

const baseApiUrl =
  process.env.TESLA_API_BASE_URL ||
  "https://fleet-api.prd.na.vn.cloud.tesla.com";

export class Fleet {
  private static instance: Fleet;

  private token: string = "";
  private tokenExpiresAt: number = 0;
  private refreshToken: string;

  private energyProducts: Product[] = [];

  private constructor() {
    this.refreshToken = process.env.TESLA_REFRESH_TOKEN || "";
  }

  public static getInstance(): Fleet {
    if (!Fleet.instance) {
      Fleet.instance = new Fleet();
    }
    return Fleet.instance;
  }

  async getToken() {
    if (!this.refreshToken) {
      throw new Error("Refresh token is not set");
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
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
      throw new Error(errorMsg);
    }
    const tokenData = (await tokenResponse.json()) as TokenData;
    this.token = tokenData.access_token;
    this.tokenExpiresAt = jwtDecode<JWT>(this.token).exp * 1000;
    this.refreshToken = tokenData.refresh_token;
    setEnvVar("TESLA_REFRESH_TOKEN", this.refreshToken);

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
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
      return [];
    }
  }

  async getSiteInfo(product: Product): Promise<SiteInfo | null> {
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
      return siteInfo;
    } catch (error: any) {
      const errorMsg = `Error getting Site Info for Energy Site ${product.energy_site_id} after retries: ${error.message}`;
      logger.error(errorMsg);
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
      return null;
    }
  }

  async getLiveStatus(product: Product): Promise<LiveStatus | null> {
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
      return response as LiveStatus;
    } catch (error: any) {
      const errorMsg = `Error getting Live Status for Energy Site ${product.energy_site_id} after retries: ${error.message}`;
      logger.error(errorMsg);
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
      return null;
    }
  }

  async setBackupReserve(product: Product, percent: number): Promise<void> {
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
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
    }
  }
}
