import express from "express";
import { z } from "zod";
import { Fleet } from "~/server/util/fleet";
import { validateBody } from "~/server/middleware/validateBody";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  requireSiteScope,
} from "~/server/middleware/requirePermission";
import { getElementState } from "~/shared/permissions/profile";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import AppDataSource from "~/server/database/datasource";
import type { IBasicEntity } from "~/server/types/common";
import type { ISiteSettings } from "~/server/database/models/siteSettings";
import { resolveSiteSettings } from "~/server/database/models/siteSettings";
import { geocodeUsZip, reverseGeocodeToZip } from "~/server/util/geocode";

const SiteSettingsUpdateSchema = z.object({
  siteId: z.string().min(1),
  settings: z.object({
    auto_curve_calibration_enabled: z.boolean().optional(),
    // Two input modes: a ZIP (geocoded server-side, below) or coordinates
    // the browser's own Geolocation API already resolved client-side.
    location_zip: z
      .string()
      .regex(/^\d{5}$/)
      .nullable()
      .optional(),
    location_lat: z.number().min(-90).max(90).nullable().optional(),
    location_lon: z.number().min(-180).max(180).nullable().optional(),
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
    const { siteId, settings: incomingSettings } = req.body;
    // Location fields are edited from the (admin-only) Maintenance page, not
    // the regular Manual Settings page — siteSettings.write alone (granted to
    // non-admin "write" profiles for the auto-curve-calibration toggle) isn't
    // enough to touch them.
    const touchesLocation = [
      "location_zip",
      "location_lat",
      "location_lon",
    ].some((key) =>
      Object.prototype.hasOwnProperty.call(incomingSettings, key),
    );
    if (
      touchesLocation &&
      getElementState(req.actor!.profile, "maintenance.siteLocation") !==
        "write"
    ) {
      res
        .status(403)
        .json({ success: false, message: "Insufficient permission" });
      return;
    }
    try {
      const energySiteId = await resolveEnergySiteId(email, siteId);
      if (!energySiteId) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      let settings = incomingSettings;
      const hasCoords =
        incomingSettings.location_lat != null ||
        incomingSettings.location_lon != null;
      if (incomingSettings.location_zip) {
        // ZIP entry path: geocode server-side.
        const resolved = geocodeUsZip(incomingSettings.location_zip);
        if (!resolved) {
          res.status(400).json({
            success: false,
            message: "Could not resolve location for that ZIP code",
          });
          return;
        }
        settings = {
          ...incomingSettings,
          location_lat: resolved.lat,
          location_lon: resolved.lon,
        };
      } else if (hasCoords) {
        // Browser-geolocation path: coordinates already resolved
        // client-side, no ZIP involved. Must be checked before the
        // "explicitly cleared" branch below, since the browser-geolocation
        // request also sends location_zip: null alongside real coordinates —
        // that's not a clear request. The precise lat/lon are kept as-is
        // (not snapped to a ZIP centroid); location_zip is filled in purely
        // as a friendly, editable approximation for the UI — null only for
        // coordinates with no nearby ZIP at all (open ocean, wilderness).
        settings = {
          ...incomingSettings,
          location_zip:
            incomingSettings.location_lat != null &&
            incomingSettings.location_lon != null
              ? reverseGeocodeToZip(
                  incomingSettings.location_lat,
                  incomingSettings.location_lon,
                )
              : null,
        };
      } else if (
        Object.prototype.hasOwnProperty.call(incomingSettings, "location_zip")
      ) {
        // location_zip explicitly cleared and no coordinates provided —
        // clear the whole location.
        settings = {
          ...incomingSettings,
          location_zip: null,
          location_lat: null,
          location_lon: null,
        };
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
