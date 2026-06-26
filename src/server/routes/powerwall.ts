import express from "express";
import {
  Fleet,
  isCalibrating,
  isDischargeCalibrating,
} from "~/server/util/fleet";

const MANUAL_ACTIONS = new Set([
  "setBackupReserve",
  "setOperationalMode",
  "setEnergyExports",
  "setGridCharging",
]);
import {
  parseTariffContent,
  hasTouData,
  getSeasonNames,
} from "~/server/util/tariff";

export const router = express.Router();

router.get("/sites", async (req, res, next) => {
  const email = req.session.user;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  try {
    const fleet = Fleet.getInstance(email, {
      throwOnError: false,
      mailOnError: false,
    });
    const products = await fleet.getEnergyProducts();
    const [statuses, siteInfos] = await Promise.all([
      Promise.all(products.map((p) => fleet.getLiveStatus(p))),
      Promise.all(products.map((p) => fleet.getSiteInfo(p).catch(() => null))),
    ]);
    res.json({
      success: true,
      data: products.map((p, i) => ({
        id: p.id,
        site_name: p.site_name,
        is_online:
          statuses[i] !== null && statuses[i]?.island_status === "on_grid",
        timezone: siteInfos[i]?.installation_time_zone ?? undefined,
      })),
    });
  } catch (error: any) {
    logger.error(error, "Error fetching powerwall sites");
    next(error);
  }
});

router.get("/tariff-info", async (req, res, next) => {
  const email = req.session.user;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const siteId = req.query.siteId as string | undefined;
  if (!siteId) {
    res
      .status(400)
      .json({ success: false, message: "siteId query parameter required" });
    return;
  }
  try {
    const fleet = Fleet.getInstance(email, {
      throwOnError: false,
      mailOnError: false,
    });
    const products = await fleet.getEnergyProducts();
    const product = products.find((p) => p.id === siteId);
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    const siteInfo = await fleet.getSiteInfo(product);
    const tariff = parseTariffContent(siteInfo?.tariff_content);
    const hasTou = hasTouData(tariff);
    const seasons = tariff ? getSeasonNames(tariff) : [];
    res.json({ success: true, data: { hasTou, seasons } });
  } catch (error: any) {
    logger.error(error, "Error fetching tariff info");
    next(error);
  }
});

router.get("/status", async (req, res, next) => {
  const email = req.session.user;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  try {
    const fleet = Fleet.getInstance(email, {
      throwOnError: false,
      mailOnError: false,
    });
    const products = await fleet.getEnergyProducts();
    const data = await Promise.all(
      products.map(async (product) => {
        const [live, info] = await Promise.all([
          fleet.getLiveStatus(product),
          fleet.getSiteInfo(product),
        ]);
        return {
          product,
          live,
          info,
          calibrating: live
            ? isCalibrating(live) ||
              isDischargeCalibrating(product.energy_site_id)
            : false,
        };
      }),
    );
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error(error, "Error fetching powerwall status");
    next(error);
  }
});

router.post("/apply-settings", async (req, res, next) => {
  const email = req.session.user;
  if (!email) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const { siteId, action, value } = req.body as {
    siteId?: string;
    action?: string;
    value?: string;
  };
  if (!siteId || typeof siteId !== "string") {
    res.status(400).json({ success: false, message: "siteId is required" });
    return;
  }
  if (!action || !MANUAL_ACTIONS.has(action)) {
    res.status(400).json({
      success: false,
      message: `action must be one of: ${[...MANUAL_ACTIONS].join(", ")}`,
    });
    return;
  }
  if (value === undefined || value === null) {
    res.status(400).json({ success: false, message: "value is required" });
    return;
  }
  try {
    const fleet = Fleet.getInstance(email, {
      throwOnError: true,
      mailOnError: false,
    });
    const products = await fleet.getEnergyProducts();
    const product = products.find((p) => p.id === siteId);
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    await fleet.getActionMap()[action](product, String(value));
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, "Error applying manual settings");
    next(error);
  }
});
