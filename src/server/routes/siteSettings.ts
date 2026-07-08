import express from "express";
import { z } from "zod";
import { Fleet } from "~/server/util/fleet";
import { validateBody } from "~/server/middleware/validateBody";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  requireSiteScope,
} from "~/server/middleware/requirePermission";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity } from "~/server/types/common";
import type { ISiteSettings } from "~/server/database/models/siteSettings";
import { resolveSiteSettings } from "~/server/database/models/siteSettings";

const SiteSettingsUpdateSchema = z.object({
  siteId: z.string().min(1),
  settings: z.object({
    auto_curve_calibration_enabled: z.boolean().optional(),
  }),
});

const apiLog = logger.child({ service: "api" });

export const router = express.Router();
router.use(resolveActorMiddleware);

async function resolveEnergySiteId(
  email: string,
  siteId: string,
): Promise<string | null> {
  const fleet = Fleet.getInstance(email, {
    throwOnError: false,
    mailOnError: false,
  });
  const products = await fleet.getEnergyProducts();
  const product = products.find((p) => String(p.energy_site_id) === siteId);
  return product ? String(product.energy_site_id) : null;
}

router.get(
  "/",
  requirePermission("siteSettings.access"),
  requireSiteScope({ queryKey: "siteId" }),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    const siteId = req.query.siteId as string | undefined;
    if (!siteId) {
      res
        .status(400)
        .json({ success: false, message: "siteId query parameter required" });
      return;
    }
    try {
      const energySiteId = await resolveEnergySiteId(email, siteId);
      if (!energySiteId) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }
      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<IBasicEntity & ISiteSettings>(
        "SiteSettings",
      );
      const record = await repo.findOne({ where: { site_id: energySiteId } });
      res.json({
        success: true,
        data: resolveSiteSettings(record?.settings ?? null),
      });
    } catch (error: any) {
      apiLog.error({ err: error, siteId }, "Error fetching site settings");
      next(error);
    }
  },
);

router.patch(
  "/",
  requirePermission("siteSettings.write"),
  requireSiteScope({ bodyKey: "siteId" }),
  validateBody(SiteSettingsUpdateSchema),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    const { siteId, settings } = req.body;
    try {
      const energySiteId = await resolveEnergySiteId(email, siteId);
      if (!energySiteId) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }
      const db = await AppDataSource.getInstance();
      const repo = db.getRepository<IBasicEntity & ISiteSettings>(
        "SiteSettings",
      );
      const existing = await repo.findOne({ where: { site_id: energySiteId } });
      const now = new Date();
      if (existing) {
        await repo.update(existing.id, {
          modified_time: now,
          settings: { ...existing.settings, ...settings },
        });
      } else {
        await repo.save({
          site_id: energySiteId,
          settings,
          creation_time: now,
          modified_time: now,
        });
      }
      const updated = await repo.findOne({ where: { site_id: energySiteId } });
      res.json({
        success: true,
        data: resolveSiteSettings(updated?.settings ?? null),
      });
    } catch (error: any) {
      apiLog.error({ err: error, siteId }, "Error updating site settings");
      next(error);
    }
  },
);
