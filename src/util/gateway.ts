import type { LoginResponse, SystemStatusResponse } from "~/types/common";
import { sendEmail } from "~/util/mailing";
import { retry } from "~/util/retry";

// Disable TLS certificate validation for self-signed certs (local use only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_URL = `https://${process.env.GATEWAY_IP}`;

export async function loginToGateway(): Promise<string | null> {
  try {
    const token = await retry<string>(
      async () => {
        const res = await fetch(`${BASE_URL}/api/login/Basic`, {
          signal: AbortSignal.timeout(5000),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // username: "installer",
            username: "customer",
            password: process.env.GATEWAY_PASSWORD,
          }),
        });
        if (!res.ok) {
          throw new Error(`Login failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as LoginResponse;
        return data.token;
      },
      3,
      2000,
      2,
    );
    return token;
  } catch (error: any) {
    const errorMsg = `Login error after retries: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail("Powerwall Notification", errorMsg);
    return null;
  }
}

export async function setBackupReserve(
  percent: number,
  withToken: string | null = null,
): Promise<void> {
  const token = withToken || (await loginToGateway());
  if (!token) {
    const errorMsg = "Could not obtain token. Skipping reserve update.";
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return;
  }

  try {
    await retry<void>(
      async () => {
        const res = await fetch(`${BASE_URL}/api/operation`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // backup_reserve_percent: (19 / 20) * percent + 5,
            backup_reserve_percent: 20,
            mode: "autonomous",
          }),
        });
        if (!res.ok) {
          throw new Error(
            `Failed to set reserve to ${percent}%. Status: ${res.statusText}`,
          );
        }
      },
      3,
      2000,
      2,
    );
    const infoMsg = `Successfully set reserve to ${percent}%.`;
    logger.info(infoMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${infoMsg}`,
    );
  } catch (error: any) {
    const errorMsg = `Error after retries setting reserve: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
  }
}

export async function getBatteryCharge(
  withToken: string | null = null,
): Promise<number | null> {
  const token = withToken || (await loginToGateway());
  if (!token) {
    const errorMsg = "Could not obtain token. Skipping getting battery charge.";
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return null;
  }
  try {
    // Retrieve system status with the retry mechanism
    const response = await retry(
      async () => {
        const res = await fetch(`${BASE_URL}/api/system_status`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(
            `Failed to get battery charge: ${res.status} ${res.statusText}`,
          );
        }
        return res;
      },
      3,
      2000,
      2,
    );

    const data = (await response.json()) as SystemStatusResponse;
    const batteryChargePercent =
      (data.nominal_energy_remaining / data.nominal_full_pack_energy) * 100;
    logger.info(`Battery charge: ${batteryChargePercent}%`);

    return batteryChargePercent;
  } catch (error: any) {
    const errorMsg = `Error after retries polling battery charge: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return null;
  }
}

export async function getBatteryReserve(
  withToken: string | null = null,
): Promise<number | null> {
  const token = withToken || (await loginToGateway());
  if (!token) {
    const errorMsg =
      "Could not obtain token. Skipping getting battery reserve.";
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return null;
  }
  try {
    // Retrieve system status with the retry mechanism
    const response = await retry(
      async () => {
        const res = await fetch(`${BASE_URL}/api/operation`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(
            `Failed to get battery reserve: ${res.status} ${res.statusText}`,
          );
        }
        return res;
      },
      3,
      2000,
      2,
    );

    const data = await response.json();
    logger.info(data);
    // const data = (await response.json()) as SystemStatusResponse;
    // const batteryChargePercent =
    //   (data.nominal_energy_remaining / data.nominal_full_pack_energy) * 100;

    // logger.info(`Battery charge: ${batteryChargePercent}%`);

    return null;
  } catch (error: any) {
    const errorMsg = `Error after retries polling battery reserve: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return null;
  }
}
