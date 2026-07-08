import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "~/server/util/actor";
import { SYSTEM_SCHEDULER_LOGIN_EMAIL } from "~/server/util/actor";

// Makes the current request's Actor visible inside Fleet without storing
// per-request state on the Fleet singleton instance (Fleet.getInstance(email) is
// shared across concurrent requests from different actors, so it can't hold
// per-request state on `this`). Follows the promise chain through awaits,
// unlike the deprecated `domain` module.
export const actorContextStorage = new AsyncLocalStorage<Actor>();

export function getCurrentActor(): Actor | undefined {
  return actorContextStorage.getStore();
}

// Used by the cron scheduler and any other Fleet call that runs outside an HTTP
// request lifecycle, so those calls still get an audit trail with a recognizable
// actor identity instead of "unknown".
export function runAsSystemScheduler<T>(
  accountEmail: string,
  fn: () => Promise<T>,
): Promise<T> {
  return actorContextStorage.run(
    {
      loginEmail: SYSTEM_SCHEDULER_LOGIN_EMAIL,
      source: "system",
      accountEmail,
      profile: "admin",
      siteIds: "*",
    },
    fn,
  );
}
