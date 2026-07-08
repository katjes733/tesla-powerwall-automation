import AppDataSource from "~/server/database/datasource";
import { getByEmail as getRefreshTokenByEmail } from "~/server/util/routes/refreshToken";
import type { Actor, ActorSource } from "~/server/util/actor";
import type { ProfileName } from "~/shared/permissions/profile";
import type { DelegationGrant } from "~/shared/schemas/delegation";
import type { IUser } from "~/server/database/models/user";

export interface AccessibleAccount {
  accountEmail: string;
  profile: ProfileName;
  siteIds: string[] | "*";
  source: Exclude<ActorSource, "system">;
}

// Ownership is derived from RefreshToken presence, not stored as mutable data —
// RefreshToken already is the authoritative signal that a login completed
// Tesla's OAuth handshake as an account owner (Fleet.getToken() depends on it).
// Delegate grants are read directly off the login's own users row
// (user_permissions.delegations) — a single lookup by primary key/email, no
// cross-table scan, since that's exactly where delegation storage puts them.
export async function listAccessibleAccounts(
  loginEmail: string,
): Promise<AccessibleAccount[]> {
  const accounts: AccessibleAccount[] = [];

  const ownToken = await getRefreshTokenByEmail(loginEmail);
  if (ownToken) {
    accounts.push({
      accountEmail: loginEmail,
      profile: "admin",
      siteIds: "*",
      source: "owner",
    });
  }

  const userRepo = (await AppDataSource.getInstance()).getRepository<IUser>(
    "User",
  );
  const userRow = await userRepo.findOne({
    where: { email: loginEmail },
    select: ["user_permissions"],
  });
  const delegations = (userRow?.user_permissions?.delegations ??
    []) as DelegationGrant[];
  for (const grant of delegations) {
    if (grant.status !== "active") continue;
    // Defense in depth: a self-grant should never be created (the invite/update
    // handlers reject delegate_email === tesla_account_email outright), but if one
    // ever existed it must never be allowed to override the owner-derived entry.
    if (grant.tesla_account_email === loginEmail) continue;
    accounts.push({
      accountEmail: grant.tesla_account_email,
      profile: grant.profile,
      siteIds: grant.site_ids,
      source: "delegate",
    });
  }

  return accounts;
}

export type SelectAccountResult =
  | AccessibleAccount
  | { error: "no_access" | "ambiguous" | "not_authorized_for_account" };

// Picks which of listAccessibleAccounts(...) applies to a given request. Today
// there's always exactly one candidate in practice (one grant per delegate),
// but this already supports an optional X-Account-Email request header for
// when a login ends up with multiple accessible accounts in the future.
export function selectActiveAccount(
  accounts: AccessibleAccount[],
  requestedAccountEmail?: string,
): SelectAccountResult {
  if (accounts.length === 0) return { error: "no_access" };
  if (requestedAccountEmail) {
    const match = accounts.find(
      (a) => a.accountEmail === requestedAccountEmail,
    );
    return match ?? { error: "not_authorized_for_account" };
  }
  if (accounts.length === 1) return accounts[0];
  const owner = accounts.find((a) => a.source === "owner");
  if (owner) return owner;
  return { error: "ambiguous" };
}

export async function resolveActor(
  loginEmail: string,
  requestedAccountEmail?: string,
): Promise<
  Actor | { error: "no_access" | "ambiguous" | "not_authorized_for_account" }
> {
  const accounts = await listAccessibleAccounts(loginEmail);
  const selected = selectActiveAccount(accounts, requestedAccountEmail);
  if ("error" in selected) return selected;
  return {
    loginEmail,
    source: selected.source,
    accountEmail: selected.accountEmail,
    profile: selected.profile,
    siteIds: selected.siteIds,
  };
}
