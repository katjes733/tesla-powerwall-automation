import express from "express";
import {
  Fleet,
  isCalibrating,
  isDischargeCalibrating,
} from "~/server/util/fleet";
import { getByEmail } from "~/server/util/routes/schedule";
import { getActiveHolidayName } from "~/server/util/holidays";
import type { HolidayEntry } from "~/server/database/models/schedule";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import {
  requirePermission,
  requireSiteScope,
  isWithinSiteScope,
} from "~/server/middleware/requirePermission";

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

const apiLog = logger.child({ service: "api" });

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get(
  "/sites",
  requirePermission("powerwall.access"),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const allProducts = await fleet.getEnergyProducts();
      const products = allProducts.filter((p) =>
        isWithinSiteScope([String(p.energy_site_id)], req.actor!.siteIds),
      );
      const [statuses, siteInfos] = await Promise.all([
        Promise.all(products.map((p) => fleet.getLiveStatus(p))),
        Promise.all(
          products.map((p) => fleet.getSiteInfo(p).catch(() => null)),
        ),
      ]);
      res.json({
        success: true,
        data: products.map((p, i) => ({
          id: String(p.energy_site_id),
          site_name: p.site_name,
          is_online:
            statuses[i] !== null && statuses[i]?.island_status === "on_grid",
          timezone: siteInfos[i]?.installation_time_zone ?? undefined,
        })),
      });
    } catch (error: any) {
      apiLog.error({ err: error }, "Error fetching powerwall sites");
      next(error);
    }
  },
);

router.get(
  "/tariff-info",
  requirePermission("powerwall.access"),
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
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find((p) => String(p.energy_site_id) === siteId);
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
      apiLog.error({ err: error }, "Error fetching tariff info");
      next(error);
    }
  },
);

router.get(
  "/status",
  requirePermission("powerwall.access"),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const [allProducts, schedules] = await Promise.all([
        fleet.getEnergyProducts(),
        getByEmail(email),
      ]);
      const products = allProducts.filter((p) =>
        isWithinSiteScope([String(p.energy_site_id)], req.actor!.siteIds),
      );
      const holidaySchedules = schedules.filter((s) =>
        (s.actions ?? []).some((a) => a.action === "setTouHolidayOverride"),
      );
      const data = await Promise.all(
        products.map(async (product) => {
          const [live, info] = await Promise.all([
            fleet.getLiveStatus(product),
            fleet.getSiteInfo(product),
          ]);
          const tz = info?.installation_time_zone ?? "UTC";
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
          }).format(new Date());
          const siteIdStr = String(product.energy_site_id);
          const holidaySchedule = holidaySchedules.find((s) =>
            s.site_ids.includes(siteIdStr),
          );
          const holidayEntries =
            ((holidaySchedule?.conditions ?? []).find(
              (c) => c.condition === "holidayList",
            )?.value as HolidayEntry[] | undefined) ?? [];
          const activeHoliday = getActiveHolidayName(holidayEntries, today);
          return {
            product,
            live,
            info,
            calibrating: live
              ? isCalibrating(live) ||
                isDischargeCalibrating(product.energy_site_id)
              : false,
            activeHoliday,
          };
        }),
      );
      res.json({ success: true, data });
    } catch (error: any) {
      apiLog.error({ err: error }, "Error fetching powerwall status");
      next(error);
    }
  },
);

router.post(
  "/apply-settings",
  requirePermission("powerwall.applySettings"),
  requireSiteScope({ bodyKey: "siteId" }),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
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
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }
      await fleet.getActionMap()[action](product, String(value));
      res.json({ success: true });
    } catch (error: any) {
      apiLog.error({ err: error }, "Error applying manual settings");
      next(error);
    }
  },
);

router.get(
  "/history",
  requirePermission("powerwall.access"),
  requireSiteScope({ queryKey: "siteId" }),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    const siteId = req.query.siteId as string | undefined;
    const date = req.query.date as string | undefined;
    const forceRefresh = req.query.refresh === "true";

    if (!siteId) {
      res
        .status(400)
        .json({ success: false, message: "siteId query parameter required" });
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        message: "date query parameter required (YYYY-MM-DD)",
      });
      return;
    }

    try {
      const fleet = Fleet.getInstance(email, {
        throwOnError: false,
        mailOnError: false,
      });
      const products = await fleet.getEnergyProducts();
      const product = products.find((p) => String(p.energy_site_id) === siteId);
      if (!product) {
        res.status(404).json({ success: false, message: "Site not found" });
        return;
      }

      const siteInfo = await fleet.getSiteInfo(product);
      const timezone = siteInfo?.installation_time_zone ?? "UTC";

      const [{ points, cached }, { points: socPoints }] = await Promise.all([
        fleet.getDayHistory(product, timezone, date, forceRefresh),
        fleet.getDaySoeHistory(product, timezone, date, forceRefresh),
      ]);

      res.json({ success: true, data: { date, points, socPoints, cached } });
    } catch (error: any) {
      apiLog.error({ err: error }, "Error fetching power history");
      next(error);
    }
  },
);
