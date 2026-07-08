import express from "express";
import { Fleet } from "~/server/util/fleet";
import { validateBody } from "~/server/middleware/validateBody";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  requireSiteScope,
} from "~/server/middleware/requirePermission";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
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

router.use(resolveActorMiddleware);

router.get(
  "/list",
  requirePermission("touConfig.access"),
  requireSiteScope({ queryKey: "siteId" }),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req) as string;
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
  },
);

router.post(
  "/save",
  requirePermission("touConfig.edit"),
  requireSiteScope({ bodyKey: "site_id" }),
  validateBody(TouConfigSaveSchema),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req) as string;
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
  requirePermission("touConfig.delete"),
  validateBody(TouConfigDeleteSchema),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req) as string;
    const actor = req.actor!;
    const { id } = req.body;
    try {
      // TouConfigDeleteSchema carries no site_id, so site scope can't be checked from
      // the request body alone — fetch the config first to check its actual site.
      if (actor.siteIds !== "*") {
        const db = await (
          await import("~/server/database/datasource")
        ).default.getInstance();
        const existing = await db
          .getRepository("TouScheduleConfig")
          .findOne({ where: { id, email } });
        if (
          existing &&
          !(actor.siteIds as string[]).includes(existing.site_id)
        ) {
          res.status(403).json({
            success: false,
            message: "Not authorized for this config's site",
          });
          return;
        }
      }
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
  requirePermission("touConfig.apply"),
  requireSiteScope({ bodyKey: "site_id" }),
  validateBody(TouConfigApplySchema),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req) as string;
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

router.get(
  "/current",
  requirePermission("touConfig.access"),
  requireSiteScope({ queryKey: "siteId" }),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req) as string;
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
  },
);
