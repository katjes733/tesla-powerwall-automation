import express from "express";
import { Fleet } from "~/server/util/fleet";

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
    const statuses = await Promise.all(
      products.map((p) => fleet.getLiveStatus(p)),
    );
    res.json({
      success: true,
      data: products.map((p, i) => ({
        id: p.id,
        site_name: p.site_name,
        is_online:
          statuses[i] !== null && statuses[i]?.island_status === "on_grid",
      })),
    });
  } catch (error: any) {
    logger.error(error, "Error fetching powerwall sites");
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
        return { product, live, info };
      }),
    );
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error(error, "Error fetching powerwall status");
    res.status(500).json({ success: false, message: error.message });
  }
});
