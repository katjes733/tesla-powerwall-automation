import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedisSet = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
vi.mock("~/server/util/redis", () => ({
  redis: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));

const mockFindOneBy = vi.fn();
const mockInsert = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({
        findOneBy: mockFindOneBy,
        insert: mockInsert,
      }),
    }),
  },
}));

import {
  storePendingSignup,
  getPendingSignup,
  deletePendingSignup,
  materializePendingSignupIfAny,
} from "~/server/util/pendingSignup";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("storePendingSignup", () => {
  it("stores the JSON-encoded payload under a namespaced key with a 24h TTL", async () => {
    await storePendingSignup("new@example.com", { passwordHash: "hash123" });
    expect(mockRedisSet).toHaveBeenCalledWith(
      "pending-signup:new@example.com",
      JSON.stringify({ passwordHash: "hash123" }),
      "EX",
      24 * 60 * 60,
    );
  });
});

describe("getPendingSignup", () => {
  it("returns the parsed payload when a pending signup exists", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ passwordHash: "hash123" }));
    const result = await getPendingSignup("new@example.com");
    expect(result).toEqual({ passwordHash: "hash123" });
    expect(mockRedisGet).toHaveBeenCalledWith("pending-signup:new@example.com");
  });

  it("returns null when no pending signup exists", async () => {
    mockRedisGet.mockResolvedValue(null);
    expect(await getPendingSignup("nobody@example.com")).toBeNull();
  });

  it("fails closed (returns null, not a throw) when Redis is unreachable", async () => {
    mockRedisGet.mockRejectedValue(new Error("connection refused"));
    expect(await getPendingSignup("new@example.com")).toBeNull();
  });
});

describe("deletePendingSignup", () => {
  it("deletes the namespaced key", async () => {
    await deletePendingSignup("new@example.com");
    expect(mockRedisDel).toHaveBeenCalledWith("pending-signup:new@example.com");
  });
});

describe("materializePendingSignupIfAny", () => {
  it("no-ops when there is no pending signup for the email", async () => {
    mockRedisGet.mockResolvedValue(null);
    await materializePendingSignupIfAny("owner@example.com");
    expect(mockFindOneBy).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it("inserts a real users row from the pending payload and clears the Redis key", async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        passwordHash: "hash123",
        userDetails: { foo: "bar" },
      }),
    );
    mockFindOneBy.mockResolvedValue(null);

    await materializePendingSignupIfAny("new@example.com");

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      email: "new@example.com",
      password_hash: "hash123",
      user_details: { foo: "bar" },
      user_permissions: {},
    });
    expect(mockRedisDel).toHaveBeenCalledWith("pending-signup:new@example.com");
  });

  it("does not overwrite an already-materialized row, but still clears the Redis key", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ passwordHash: "hash123" }));
    mockFindOneBy.mockResolvedValue({ id: "existing-id" });

    await materializePendingSignupIfAny("new@example.com");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockRedisDel).toHaveBeenCalledWith("pending-signup:new@example.com");
  });
});
