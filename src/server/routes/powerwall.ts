import express from "express";
import {
  Fleet,
  isCalibrating,
  isDischargeCalibrating,
} from "~/server/util/fleet";
import {
  parseTariffContent,
  hasTouData,
  getSeasonNames,
} from "~/server/util/tariff";

export const router = express.Router();

router.get("/sites", async (req, res) => {
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
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/tariff-info", async (req, res) => {
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
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/status", async (req, res) => {
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
    res.status(500).json({ success: false, message: error.message });
  }
});
