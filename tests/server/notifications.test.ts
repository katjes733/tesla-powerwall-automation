import { describe, it, expect } from "bun:test";
import {
  isTokenStale,
  TOKEN_STALE_THRESHOLD_MS,
  notifyOnce,
  clearNotification,
  type RedisDedup,
} from "~/server/util/notificationDedup";

function createRedisFake(): RedisDedup & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    exists: async (key: string) => (store.has(key) ? 1 : 0) as number,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    },
    store,
  };
}

const brokenExists: RedisDedup = {
  exists: async () => {
    throw new Error("Redis down");
  },
  set: async () => "OK",
  del: async () => 1,
};

const brokenSet: RedisDedup = {
  exists: async () => 0,
  set: async () => {
    throw new Error("Redis down");
  },
  del: async () => 1,
};

const brokenDel: RedisDedup = {
  exists: async () => 0,
  set: async () => "OK",
  del: async () => {
    throw new Error("Redis down");
  },
};

// ---------------------------------------------------------------------------
// isTokenStale — pure function
// ---------------------------------------------------------------------------

describe("isTokenStale", () => {
  const NOW_MS = 1_000_000_000_000;

  it("returns true when token expired more than 2 hours ago", () => {
    const expiresAt = new Date(NOW_MS - TOKEN_STALE_THRESHOLD_MS - 1);
    expect(isTokenStale(expiresAt, NOW_MS)).toBe(true);
  });

  it("returns false when token expired exactly at the stale threshold boundary (strict <)", () => {
    const expiresAt = new Date(NOW_MS - TOKEN_STALE_THRESHOLD_MS);
    expect(isTokenStale(expiresAt, NOW_MS)).toBe(false);
  });

  it("returns false when token expired less than 2 hours ago", () => {
    const expiresAt = new Date(NOW_MS - TOKEN_STALE_THRESHOLD_MS + 60_000);
    expect(isTokenStale(expiresAt, NOW_MS)).toBe(false);
  });

  it("returns false when token expires in the future", () => {
    const expiresAt = new Date(NOW_MS + 60 * 60 * 1000);
    expect(isTokenStale(expiresAt, NOW_MS)).toBe(false);
  });

  it("returns false when token just expired (under 1 minute ago)", () => {
    const expiresAt = new Date(NOW_MS - 30_000);
    expect(isTokenStale(expiresAt, NOW_MS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notifyOnce
// ---------------------------------------------------------------------------

describe("notifyOnce", () => {
  it("calls send and sets key when key is absent", async () => {
    const redis = createRedisFake();
    let called = false;
    const sent = await notifyOnce(
      "k",
      () => {
        called = true;
      },
      redis,
    );
    expect(sent).toBe(true);
    expect(called).toBe(true);
    expect(await redis.exists("k")).toBe(1);
  });

  it("suppresses send when key is already present", async () => {
    const redis = createRedisFake();
    await redis.set("k", "1");
    let called = false;
    const sent = await notifyOnce(
      "k",
      () => {
        called = true;
      },
      redis,
    );
    expect(sent).toBe(false);
    expect(called).toBe(false);
  });

  it("returns false and does not call send on second invocation without clearing", async () => {
    const redis = createRedisFake();
    let callCount = 0;
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    expect(callCount).toBe(1);
  });

  it("calls send again after clearNotification removes the key", async () => {
    const redis = createRedisFake();
    let callCount = 0;
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    await clearNotification("k", redis);
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    expect(callCount).toBe(2);
  });

  it("calls send when Redis.exists throws (fail-open)", async () => {
    let called = false;
    const sent = await notifyOnce(
      "k",
      () => {
        called = true;
      },
      brokenExists,
    );
    expect(sent).toBe(true);
    expect(called).toBe(true);
  });

  it("still returns true and called=true when Redis.set throws after sending", async () => {
    let called = false;
    const sent = await notifyOnce(
      "k",
      () => {
        called = true;
      },
      brokenSet,
    );
    expect(sent).toBe(true);
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearNotification
// ---------------------------------------------------------------------------

describe("clearNotification", () => {
  it("removes an existing key from the store", async () => {
    const redis = createRedisFake();
    await redis.set("k", "1");
    expect(await redis.exists("k")).toBe(1);
    await clearNotification("k", redis);
    expect(await redis.exists("k")).toBe(0);
  });

  it("resolves without throwing when the key does not exist", async () => {
    const redis = createRedisFake();
    await expect(
      clearNotification("nonexistent", redis),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when Redis.del throws", async () => {
    await expect(clearNotification("k", brokenDel)).resolves.toBeUndefined();
  });

  it("allows notifyOnce to fire again after clearing", async () => {
    const redis = createRedisFake();
    let callCount = 0;
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    expect(callCount).toBe(1);
    await clearNotification("k", redis);
    await notifyOnce(
      "k",
      () => {
        callCount++;
      },
      redis,
    );
    expect(callCount).toBe(2);
  });
});
