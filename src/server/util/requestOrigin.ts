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

const IP_ADDRESS_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// WebAuthn's rpID must be a stable, registrable domain — never derived from a
// per-request Host header (an attacker-controlled header would let a forged
// assertion pass rpID validation) and never a raw IP address (the WebAuthn
// spec/browser platform authenticators reject IP-address rpIDs outright, so a
// LAN deployment reachable only by IP simply cannot offer WebAuthn there).
// Read explicitly from env vars instead, mirroring the ALLOWED_ORIGINS pattern.
export function getWebauthnConfig(): {
  rpID: string;
  expectedOrigin: string[];
} {
  const isDev = process.env.NODE_ENV === "development";
  const rpID = process.env.WEBAUTHN_RP_ID || (isDev ? "localhost" : undefined);
  if (!rpID) {
    throw new Error("WEBAUTHN_RP_ID environment variable is required");
  }
  if (IP_ADDRESS_PATTERN.test(rpID)) {
    throw new Error(
      `WEBAUTHN_RP_ID must be a registrable domain name, not an IP address: "${rpID}"`,
    );
  }

  const expectedOrigin = (
    process.env.WEBAUTHN_EXPECTED_ORIGINS ||
    (isDev ? "https://localhost:5173" : "")
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (expectedOrigin.length === 0) {
    throw new Error(
      "WEBAUTHN_EXPECTED_ORIGINS environment variable is required",
    );
  }

  return { rpID, expectedOrigin };
}
