import express from "express";
import { Fleet } from "~/server/util/fleet";
import { requireAuth } from "~/server/middleware/auth";
import { validateBody } from "~/server/middleware/validateBody";
import {
  TouConfigSaveSchema,
  TouConfigDeleteSchema,
  TouConfigApplySchema,
} from "~/shared/schemas/touConfig";
import {
  listByEmailAndSite,
  save,
  deleteById,
  setActive,
} from "~/server/util/routes/touConfig";

export const router = express.Router();

router.use(requireAuth);

router.get("/list", async (req, res, next) => {
  const email = req.session.user as string;
  const siteId = req.query.siteId as string | undefined;
  if (!siteId) {
    res
      .status(400)
      .json({ success: false, message: "siteId query parameter required" });
    return;
  }
  try {
    const configs = await listByEmailAndSite(email, siteId);
    res.json({ success: true, data: configs });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/save",
  validateBody(TouConfigSaveSchema),
  async (req, res, next) => {
    const email = req.session.user as string;
    const { id, schedule_name, site_id, schedule_config, mark_active } =
      req.body;
    try {
      const result = await save({
        id,
        email,
        schedule_name,
        site_id,
        schedule_config,
      });
      if (mark_active) {
        await setActive(result.id, email, site_id);
      }
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/delete",
  validateBody(TouConfigDeleteSchema),
  async (req, res, next) => {
    const email = req.session.user as string;
    const { id } = req.body;
    try {
      const result = await deleteById(id, email);
      if (result.status === 404) {
        res.status(404).json({ success: false, message: "Config not found" });
        return;
      }
      res.status(204).json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/apply",
  validateBody(TouConfigApplySchema),
  async (req, res, next) => {
    const email = req.session.user as string;
    const { id, site_id, backup = true } = req.body;
    try {
      const db = await (
        await import("~/server/database/datasource")
      ).default.getInstance();
      const repo = db.getRepository("TouScheduleConfig");
      const config = await repo.findOne({ where: { id, email } });
      if (!config) {
        res.status(404).json({ success: false, message: "Config not found" });
        return;
      }

      const fleet = Fleet.getInstance(email, {
        throwOnError: true,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find(
        (p) => String(p.energy_site_id) === site_id,
      );
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const siteInfo = await fleet.getSiteInfo(product);
      if (backup && siteInfo?.tariff_content_v2) {
        const now = new Date();
        const backupName = `Auto-backup ${now.toISOString().slice(0, 16).replace("T", " ")}`;
        await save({
          email,
          schedule_name: backupName,
          site_id,
          schedule_config: siteInfo.tariff_content_v2 as Record<
            string,
            unknown
          >,
        });
      }

      await fleet.setTouSchedule(
        product,
        config.schedule_config as Record<string, any>,
      );
      await setActive(id, email, site_id);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/current", async (req, res, next) => {
  const email = req.session.user as string;
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
    const product = products.find(
      (p) => String(p.energy_site_id) === siteId || p.id === siteId,
    );
    if (!product) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }
    const siteInfo = await fleet.getSiteInfo(product);
    res.json({
      success: true,
      data: { tariff_content_v2: siteInfo?.tariff_content_v2 ?? {} },
    });
  } catch (error) {
    next(error);
  }
});
