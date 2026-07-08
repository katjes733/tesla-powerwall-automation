import type { Request, Response, NextFunction } from "express";
import { resolveActor } from "~/server/util/resolveActor";
import { actorContextStorage } from "~/server/util/actorContext";
import type { Actor } from "~/server/util/actor";

function makeResolveActorMiddleware(opts: { allowUnlinkedBootstrap: boolean }) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const loginEmail = req.session.user as string | undefined;
    if (!loginEmail) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    const requestedAccountEmail = req.get("x-account-email") ?? undefined;
    const result = await resolveActor(loginEmail, requestedAccountEmail);
    if ("error" in result) {
      if (
        opts.allowUnlinkedBootstrap &&
        result.error === "no_access" &&
        !requestedAccountEmail
      ) {
        // A brand-new self-signup login with no RefreshToken and no delegation
        // grant yet — the only account-scoped surface they're allowed to reach
        // before completing Tesla OAuth is this one (to actually link it), so
        // they're treated as the provisional owner of their own email. Every
        // other router still enforces the strict check below.
        const bootstrapActor: Actor = {
          loginEmail,
          source: "owner",
          accountEmail: loginEmail,
          profile: "admin",
          siteIds: "*",
        };
        req.actor = bootstrapActor;
        actorContextStorage.run(bootstrapActor, () => next());
        return;
      }
      res
        .status(result.error === "ambiguous" ? 400 : 403)
        .json({ success: false, message: result.error });
      return;
    }
    req.actor = result;
    actorContextStorage.run(result, () => next());
  };
}

// Resolves the full Actor (owner or delegate, effective profile, site scope) for
// every account-scoped request and attaches it to req.actor. Recomputed on every
// request, not cached in the session — an admin revoking or downgrading a
// delegate takes effect on the delegate's very next request, no stale-permission
// window. Must run after session auth (req.session.user must already be set).
export const resolveActorMiddleware = makeResolveActorMiddleware({
  allowUnlinkedBootstrap: false,
});

// Same as resolveActorMiddleware, but lets a login with zero accessible
// accounts through as a provisional self-owner instead of 403ing. Used only by
// maintenance.ts, whose entire purpose for such a login is to complete the
// Tesla OAuth flow that creates their first RefreshToken — every other
// account-scoped router keeps the strict check.
export const resolveActorAllowingUnlinked = makeResolveActorMiddleware({
  allowUnlinkedBootstrap: true,
});
