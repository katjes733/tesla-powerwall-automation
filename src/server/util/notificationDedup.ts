export const TOKEN_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export function isTokenStale(
  expiresAt: Date,
  nowMs: number = Date.now(),
): boolean {
  return expiresAt.getTime() < nowMs - TOKEN_STALE_THRESHOLD_MS;
}

export interface RedisDedup {
  exists: (_key: string) => Promise<number>;
  set: (_key: string, _value: string) => Promise<unknown>;
  del: (..._keys: string[]) => Promise<unknown>;
}

/**
 * Calls `send` once per error occurrence. Returns true if the notification was
 * sent (key was absent), false if it was suppressed (key was present).
 *
 * Fail-open: if Redis is unavailable, `send` is always called so that
 * alerts are never silently dropped.
 */
export async function notifyOnce(
  key: string,
  send: () => void,
  redisClient: RedisDedup,
): Promise<boolean> {
  const already = await redisClient.exists(key).catch(() => 0);
  if (!already) {
    send();
    await redisClient.set(key, "1").catch(() => {});
    return true;
  }
  return false;
}

/** Clears a dedup key so the next call to notifyOnce for that key will fire. */
export async function clearNotification(
  key: string,
  redisClient: RedisDedup,
): Promise<void> {
  await redisClient.del(key).catch(() => {});
}
