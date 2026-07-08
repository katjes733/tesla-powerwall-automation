import type { ProfileName } from "~/shared/permissions/profile";

export type ActorSource = "owner" | "delegate" | "system";

export interface Actor {
  loginEmail: string; // the actual authenticated login identity; "system:scheduler" for cron
  source: ActorSource;
  accountEmail: string; // the Tesla account this request is acting on behalf of
  profile: ProfileName; // effective profile for accountEmail
  siteIds: string[] | "*"; // accessible sites under accountEmail
}

export const SYSTEM_SCHEDULER_LOGIN_EMAIL = "system:scheduler";
