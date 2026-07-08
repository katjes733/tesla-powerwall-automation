import type { Request } from "express";

// Prefer X-Forwarded-Host over the raw Host header: a reverse proxy in front
// of this server may rewrite Host to its own upstream target (e.g. the
// container's internal IP:port) while still forwarding the original public
// host via X-Forwarded-Host, per common reverse-proxy convention.
//
// This is the *API server's* own origin — correct for building the Tesla
// OAuth /callback redirect URI, which is an Express-only route. In dev, the
// Vite dev server (where the SPA is actually served) proxies /api to this
// server and deliberately rewrites the Host header to match it (see
// vite.config.ts), so req.get("host") here reflects the API's port (3001),
// not the browser's real address bar (5173). Do not reuse this for links
// meant to be opened in a browser — use getAppUrl() instead.
export function getPublicOrigin(req: Request): string {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  return `${req.protocol}://${host}`;
}

// Where users actually access the app in a browser — used for links in
// outbound emails (signup/invite links). In production this is normally the
// same origin as the API (a single deployed app), so it defaults to
// getPublicOrigin(req). In dev, the SPA is served by Vite on a different port
// than the API, so set APP_URL (e.g. http://localhost:5173) to override.
//
// Some emails (Fleet token-refresh failures, the scheduler's stale-token cron
// check) are built with no HTTP request in scope at all — there's no req to
// fall back to. Those callers read process.env.APP_URL directly instead and
// omit the link entirely if it isn't set, rather than build one that's wrong.
export function getAppUrl(req: Request): string {
  return process.env.APP_URL || getPublicOrigin(req);
}
