import { z } from "zod";
import { SiteIdsSchema } from "~/shared/schemas/delegation";

export const NotificationPreferencesDataSchema = z.object({
  calibration_events: SiteIdsSchema.optional(),
  calibration_job_outcomes: SiteIdsSchema.optional(),
  site_action_failures: SiteIdsSchema.optional(),
  site_status_unavailable: SiteIdsSchema.optional(),
  schedule_issues: SiteIdsSchema.optional(),
  // account-wide — only ever "*" (on) or [] (off) in practice, see NOTIFICATION_TYPE_SCOPE
  account_health: SiteIdsSchema.optional(),
});
export type NotificationPreferencesData = z.infer<
  typeof NotificationPreferencesDataSchema
>;
export type NotificationType = keyof NotificationPreferencesData;
export type NotificationRole = "owner" | "delegate";

// Whether a type is scoped by specific sites (checked against event
// site-overlap) or is account-wide (checked as "non-empty/'*' means on").
// Adding a new notification type means adding one entry here alongside the
// schema field above — nothing else keys off a hardcoded type name.
export const NOTIFICATION_TYPE_SCOPE: Record<
  NotificationType,
  "site" | "account"
> = {
  calibration_events: "site",
  calibration_job_outcomes: "site",
  site_action_failures: "site",
  site_status_unavailable: "site",
  schedule_issues: "site",
  account_health: "account",
};

// Each type owns its own default-by-role policy (all six use the same rule
// today, but this stays a map of functions rather than one hardcoded branch
// so a future type can differ).
const NOTIFICATION_DEFAULTS: {
  [K in NotificationType]: (role: NotificationRole) => string[] | "*";
} = {
  calibration_events: (role) => (role === "owner" ? "*" : []),
  calibration_job_outcomes: (role) => (role === "owner" ? "*" : []),
  site_action_failures: (role) => (role === "owner" ? "*" : []),
  site_status_unavailable: (role) => (role === "owner" ? "*" : []),
  schedule_issues: (role) => (role === "owner" ? "*" : []),
  account_health: (role) => (role === "owner" ? "*" : []),
};

export function resolveNotificationPreferences(
  stored: NotificationPreferencesData | null | undefined,
  role: NotificationRole,
): Required<NotificationPreferencesData> {
  const result = {} as Required<NotificationPreferencesData>;
  for (const type of Object.keys(NOTIFICATION_DEFAULTS) as NotificationType[]) {
    result[type] = stored?.[type] ?? NOTIFICATION_DEFAULTS[type](role);
  }
  return result;
}
