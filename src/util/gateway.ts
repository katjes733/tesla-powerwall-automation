import type { LoginResponse, SystemStatusResponse } from "~/types/common";
import { sendEmail } from "~/util/mailing";
import { retry } from "~/util/retry";

// Disable TLS certificate validation for self-signed certs (local use only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_URL = `https://${process.env.GATEWAY_IP}`;

async function loginToGateway(): Promise<string | null> {
  try {
    const token = await retry<string>(
      async () => {
        const res = await fetch(`${BASE_URL}/api/login/Basic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "installer",
            password: process.env.PASSWORD,
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
          body: JSON.stringify({ backup_reserve_percent: percent }),
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

export async function setBackupReserveWhenFullyCharged(
  percent: number,
  withToken: string | null = null,
): Promise<void> {
  const token = withToken || (await loginToGateway());
  if (!token) {
    const errorMsg =
      "Could not obtain token. Skipping reserve update when fully charged.";
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
    return;
  }
  const current_charge = (await getBatteryCharge()) || 0;
  if (current_charge >= 100) {
    const infoMsg = `Battery fully charged (${current_charge}%). Setting reserve to ${percent}%.`;
    logger.info(infoMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${infoMsg}`,
    );
    await setBackupReserve(percent, token);
  }
}

export async function getBatteryCharge(): Promise<number | null> {
  try {
    // Retrieve system status with the retry mechanism
    const response = await retry(
      async () => {
        const res = await fetch(`${BASE_URL}/api/system_status`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          throw new Error(
            `Failed to get system status: ${res.status} ${res.statusText}`,
          );
        }
        return res;
      },
      3,
      2000,
      2,
    );

    // Cast the response to our expected interface
    const data = (await response.json()) as SystemStatusResponse;
    logger.info(`Battery charge: ${data.battery_state_of_charge}%`);

    return data.battery_state_of_charge;
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
