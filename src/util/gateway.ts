import type { LoginResponse } from "~/types/common";
import { sendEmail } from "~/util/mailing";
import { retry } from "~/util/retry";

// Disable TLS certificate validation for self-signed certs (local use only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_URL = `https://${process.env.GATEWAY_IP}`;

async function loginToGateway(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/login/Basic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "installer",
        password: process.env.PASSWORD,
      }),
    });

    if (!res.ok) {
      const errorMsg = `Login failed: ${res.status} ${res.statusText}`;
      logger.error(errorMsg);
      await sendEmail("Powerwall Notification", errorMsg);
      return null;
    }

    const data = (await res.json()) as LoginResponse;
    return data.token;
  } catch (error: any) {
    const errorMsg = `Login error after retries: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail("Powerwall Notification", errorMsg);
    return null;
  }
}

export async function setBackupReserve(percent: number): Promise<void> {
  const token = await loginToGateway();
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
    const res = await fetch(`${BASE_URL}/api/operation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ backup_reserve_percent: percent }),
    });

    if (!res.ok) {
      const errorMsg = `Failed to set reserve to ${percent}%. Status: ${res.statusText}`;
      logger.error(errorMsg);
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] ${errorMsg}`,
      );
    } else {
      const infoMsg = `Successfully set reserve to ${percent}%.`;
      logger.info(infoMsg);
      await sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] ${infoMsg}`,
      );
    }
  } catch (error: any) {
    const errorMsg = `Error setting reserve: ${error.message}`;
    logger.error(errorMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${errorMsg}`,
    );
  }
}
