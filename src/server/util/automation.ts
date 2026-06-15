import { sendEmail } from "~/server/util/mailing";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";
import { Fleet } from "~/server/util/fleet";

export async function getAllSiteInfo(email: string): Promise<SiteInfo[]> {
  return Fleet.getInstance(email)
    .getEnergyProducts()
    .then((products) => {
      return Promise.all(
        products.map((product) =>
          Fleet.getInstance(email).getSiteInfo(product),
        ),
      ).then((results) =>
        results.filter((siteInfo): siteInfo is SiteInfo => !!siteInfo),
      );
    });
}

export async function getAllLiveStatus(email: string): Promise<LiveStatus[]> {
  return Fleet.getInstance(email)
    .getEnergyProducts()
    .then((products) => {
      return Promise.all(
        products.map((product) =>
          Fleet.getInstance(email).getLiveStatus(product),
        ),
      ).then((results) =>
        results.filter((liveStatus): liveStatus is LiveStatus => !!liveStatus),
      );
    });
}

export async function getBatteryCharge(
  product: Product,
  email: string,
): Promise<number> {
  return (
    (await Fleet.getInstance(email).getLiveStatus(product))
      ?.percentage_charged || 0
  );
}

export async function setBackupReserveAll(
  percent: number,
  email: string,
): Promise<void> {
  for (const product of await Fleet.getInstance(email).getEnergyProducts()) {
    await Fleet.getInstance(email).setBackupReserve(product, percent);
  }
}

export async function setBackupReserveAllWhenFullyCharged(
  percent: number,
  email: string,
): Promise<void> {
  for (const product of await Fleet.getInstance(email).getEnergyProducts()) {
    setBackupReserveWhenFullyCharged(product, percent, email);
  }
}

export async function setBackupReserveWhenFullyCharged(
  product: Product,
  percent: number,
  email: string,
): Promise<void> {
  const current_charge = await getBatteryCharge(product, email);
  if (current_charge >= 100) {
    const infoMsg = `Battery at Energy Site ${product.energy_site_id} is fully charged (${current_charge}%). Setting Backup Reserve to ${percent}%.`;
    logger.info(infoMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${infoMsg}`,
    );
    await Fleet.getInstance(email).setBackupReserve(product, percent);
  }
}
