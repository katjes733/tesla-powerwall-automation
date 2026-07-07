import type { Request } from "express";

// Resolves the Tesla account email a request should act on behalf of.
// Today this is simply the logged-in user, but it's a dedicated seam for
// when delegate accounts (acting on behalf of a different registered email)
// are introduced.
export function getCurrentAccountEmail(req: Request): string | undefined {
  return req.session.user;
}
