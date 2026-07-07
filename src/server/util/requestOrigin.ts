import type { Request } from "express";

// Prefer X-Forwarded-Host over the raw Host header: a reverse proxy in front
// of this server may rewrite Host to its own upstream target (e.g. the
// container's internal IP:port) while still forwarding the original public
// host via X-Forwarded-Host, per common reverse-proxy convention.
export function getPublicOrigin(req: Request): string {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  return `${req.protocol}://${host}`;
}
