import type { Request, Response, NextFunction } from "express";
import { getElementState } from "~/shared/permissions/profile";
import type { ActionKey } from "~/shared/permissions/schema";

// Must run after resolveActorMiddleware (reads req.actor). Uses the exact same
// getElementState(profile, actionKey) the client uses for rendering — "write" is
// the only passing state, and it's correct for read-type actions too: everyone
// clears the "access" floor, so a .access action always resolves to "write" for
// any authenticated actor. See src/shared/permissions/profile.ts for the full
// reasoning (including why this correctly denies admin-only paths to non-admins).
export function requirePermission(actionKey: ActionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.actor) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    if (getElementState(req.actor.profile, actionKey) !== "write") {
      res
        .status(403)
        .json({ success: false, message: "Insufficient permission" });
      return;
    }
    next();
  };
}

// Reads the requested site id(s) from body/query — route bodies use "siteId"
// singular in calibration/siteSettings/touConfig, "site_ids" array in schedule —
// and 403s if any requested id isn't in req.actor.siteIds ("*" always passes).
export function requireSiteScope(opts: {
  bodyKey?: string;
  queryKey?: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    if (actor.siteIds === "*") {
      next();
      return;
    }
    const raw = opts.bodyKey
      ? req.body?.[opts.bodyKey]
      : req.query?.[opts.queryKey ?? ""];
    const requested: string[] = Array.isArray(raw)
      ? raw.map(String)
      : raw != null
        ? [String(raw)]
        : [];
    const denied = requested.filter(
      (id) => !(actor.siteIds as string[]).includes(id),
    );
    if (denied.length > 0) {
      res.status(403).json({
        success: false,
        message: `Not authorized for site(s): ${denied.join(", ")}`,
      });
      return;
    }
    next();
  };
}

// Whether every one of siteIds falls within the actor's granted scope ("*"
// always passes). Used to filter list endpoints (site lists, schedule lists)
// down to what a scoped delegate should actually see — requireSiteScope only
// guards a single requested site/body field, it doesn't filter a response.
export function isWithinSiteScope(
  siteIds: string[],
  actorSiteIds: string[] | "*",
): boolean {
  if (actorSiteIds === "*") return true;
  return siteIds.every((id) => actorSiteIds.includes(id));
}
