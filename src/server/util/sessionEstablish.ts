import type { Request } from "express";
import { resolveActor } from "~/server/util/resolveActor";
import { clearLockout } from "~/server/util/authLockout";

// Resolves the extra permission fields the client needs alongside the login
// identity. A login with no accessible account yet (a brand-new self-signup
// owner who hasn't completed Tesla OAuth) is a legitimate transient state, not
// a login failure — it's reported with accountLinked: false so the client
// restricts them to the Maintenance page until they finish linking. Any other
// resolution error (ambiguous / not_authorized_for_account) still returns null.
export async function buildSessionUser(loginEmail: string) {
  const result = await resolveActor(loginEmail);
  if ("error" in result) {
    if (result.error !== "no_access") return null;
    return {
      loginEmail,
      teslaAccountEmail: loginEmail,
      accountType: "owner" as const,
      profile: "admin" as const,
      siteIds: "*" as const,
      accountLinked: false,
    };
  }
  return {
    loginEmail: result.loginEmail,
    teslaAccountEmail: result.accountEmail,
    accountType:
      result.source === "owner" ? ("owner" as const) : ("delegate" as const),
    profile: result.profile,
    siteIds: result.siteIds,
    accountLinked: true,
  };
}

// Shared by password login and WebAuthn login — establishes the authenticated
// session identically regardless of which credential the user proved.
export async function establishSession(req: Request, email: string) {
  await clearLockout(email);
  req.session.user = email;
  if (!req.session.expiry) {
    req.session.expiry = Date.now() + (req.session.cookie.maxAge || 3600000);
  }
  return {
    message: "Logged in",
    user: await buildSessionUser(email),
    sessionExpiry: req.session.expiry,
  };
}
