import type { Request } from "express";

// Resolves the Tesla account email a request should act on behalf of. This is
// the seam anticipated by the original comment here ("a dedicated seam for when
// delegate accounts are introduced") — resolveActorMiddleware (see
// src/server/middleware/resolveActorMiddleware.ts) resolves the full Actor
// (owner or delegate) and attaches it to req.actor before any route handler
// runs; this just reads the account email back off it for callers that only
// need the plain string.
export function getCurrentAccountEmail(req: Request): string | undefined {
  return req.actor?.accountEmail;
}
