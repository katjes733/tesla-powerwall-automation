import { sendEmail } from "~/util/mailing";
import type { LiveStatus, Product, SiteInfo } from "~/types/common";
import { Fleet } from "~/util//fleet";

export async function getAllSiteInfo(): Promise<SiteInfo[]> {
  return Fleet.getInstance()
    .getEnergyProducts()
    .then((products) => {
      return Promise.all(
        products.map((product) => Fleet.getInstance().getSiteInfo(product)),
      ).then((results) =>
        results.filter((siteInfo): siteInfo is SiteInfo => !!siteInfo),
      );
    });
}

export async function getAllLiveStatus(): Promise<LiveStatus[]> {
  return Fleet.getInstance()
    .getEnergyProducts()
    .then((products) => {
      return Promise.all(
        products.map((product) => Fleet.getInstance().getLiveStatus(product)),
      ).then((results) =>
        results.filter((liveStatus): liveStatus is LiveStatus => !!liveStatus),
      );
    });
}

export async function getBatteryCharge(product: Product): Promise<number> {
  return (
    (await Fleet.getInstance().getLiveStatus(product))?.percentage_charged || 0
  );
}

export async function setBackupReserveAll(percent: number): Promise<void> {
  for (const product of await Fleet.getInstance().getEnergyProducts()) {
    await Fleet.getInstance().setBackupReserve(product, percent);
  }
}

export async function setBackupReserveAllWhenFullyCharged(
  percent: number,
): Promise<void> {
  for (const product of await Fleet.getInstance().getEnergyProducts()) {
    setBackupReserveWhenFullyCharged(product, percent);
  }
}

export async function setBackupReserveWhenFullyCharged(
  product: Product,
  percent: number,
): Promise<void> {
  const current_charge = await getBatteryCharge(product);
  if (current_charge >= 100) {
    const infoMsg = `Battery at Energy Site ${product.energy_site_id} is fully charged (${current_charge}%). Setting Backup Reserve to ${percent}%.`;
    logger.info(infoMsg);
    await sendEmail(
      "Powerwall Notification",
      `[${new Date().toLocaleString()}] ${infoMsg}`,
    );
    await Fleet.getInstance().setBackupReserve(product, percent);
  }
}
