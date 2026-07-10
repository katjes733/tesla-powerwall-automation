import AppDataSource, { qualifiedTable } from "~/server/database/datasource";
import type { IBasicEntity } from "~/server/types/common";
import type { IUser } from "~/server/database/models/user";
import type { DelegationGrant } from "~/shared/schemas/delegation";
import {
  NOTIFICATION_TYPE_SCOPE,
  resolveNotificationPreferences,
  type NotificationType,
} from "~/shared/schemas/notificationPreferences";

// "At least one shared site" — distinct from requirePermission.ts's
// isWithinSiteScope, which requires FULL containment (used only to authorize
// a PATCH request). Here we're asking "would this event, which touched these
// specific sites, interest someone scoped to this other set of sites."
function sitesOverlap(
  value: string[] | "*",
  relevantSiteIds: string[],
): boolean {
  if (value === "*") return true;
  return relevantSiteIds.some((id) => value.includes(id));
}

function isOptedIn(
  value: string[] | "*",
  notificationType: NotificationType,
  relevantSiteIds: string[] | null,
): boolean {
  if (NOTIFICATION_TYPE_SCOPE[notificationType] === "account") {
    return value === "*" || value.length > 0;
  }
  return relevantSiteIds !== null && sitesOverlap(value, relevantSiteIds);
}

/**
 * Resolves which emails should receive a given notification event: the
 * account owner plus every active, non-read-profile delegate whose *current*
 * grant covers the event's site(s) and who has opted in themselves.
 *
 * `relevantSiteIds` is null for account-wide notification types (see
 * NOTIFICATION_TYPE_SCOPE) and one or more site ids for site-scoped ones —
 * most events pass a single-element array; a few (e.g. a schedule spanning
 * multiple sites) can pass several.
 */
export async function resolveNotificationRecipients(
  accountEmail: string,
  relevantSiteIds: string[] | null,
  notificationType: NotificationType,
): Promise<string[]> {
  const db = await AppDataSource.getInstance();
  const userRepo = db.getRepository<IBasicEntity & IUser>("User");
  const recipients: string[] = [];

  const ownerRow = await userRepo.findOne({ where: { email: accountEmail } });
  const ownerPrefs = resolveNotificationPreferences(
    ownerRow?.user_details?.notification_preferences ?? null,
    "owner",
  );
  if (
    isOptedIn(ownerPrefs[notificationType], notificationType, relevantSiteIds)
  ) {
    recipients.push(accountEmail);
  }

  // Cross-table containment scan — same query shape as userAdmin.ts's
  // GET /delegates, accelerated by idx_users_user_permissions_gin.
  const delegateRows: {
    email: string;
    user_permissions: { delegations?: DelegationGrant[] } | null;
    user_details: {
      notification_preferences?: Record<string, string[] | "*">;
    } | null;
  }[] = await db.query(
    `SELECT email, user_permissions, user_details FROM ${qualifiedTable("users")} WHERE user_permissions @> $1::jsonb`,
    [JSON.stringify({ delegations: [{ tesla_account_email: accountEmail }] })],
  );

  for (const row of delegateRows) {
    const grant = (row.user_permissions?.delegations ?? []).find(
      (g) => g.tesla_account_email === accountEmail && g.status === "active",
    );
    if (!grant) continue;
    // Live re-check against the grant, not the stored preference — a
    // delegate could opt in while write, then get downgraded to read or
    // have their site scope narrowed later. notification_preferences lives
    // on a separate field from user_permissions.delegations, so a
    // profile/scope change never touches it; without this check a
    // downgraded delegate would keep receiving emails they can no longer
    // even reach a page to turn off.
    if (grant.profile === "read") continue;
    if (
      NOTIFICATION_TYPE_SCOPE[notificationType] === "site" &&
      relevantSiteIds !== null &&
      !sitesOverlap(grant.site_ids, relevantSiteIds)
    ) {
      continue;
    }
    const delegatePrefs = resolveNotificationPreferences(
      row.user_details?.notification_preferences ?? null,
      "delegate",
    );
    if (
      isOptedIn(
        delegatePrefs[notificationType],
        notificationType,
        relevantSiteIds,
      )
    ) {
      recipients.push(row.email);
    }
  }

  return Array.from(new Set(recipients));
}
