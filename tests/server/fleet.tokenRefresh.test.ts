import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — mirrors the pattern in fleet.smartCharging.test.ts: mock
// everything doTokenRefresh touches (Tesla's token endpoint, the refresh-token
// DB helpers, redis-backed dedup, and mailing) so only the resync/dedup logic
// under test actually runs.
// ---------------------------------------------------------------------------

vi.mock("~/server/util/auth", () => ({
  getNewTokenWithRefreshToken: vi.fn(),
}));
vi.mock("~/server/util/routes/refreshToken", () => ({
  getByEmail: vi.fn(),
  upsert: vi.fn(async () => ({})),
  recordRefreshError: vi.fn(async () => {}),
}));
vi.mock("~/server/util/redis", () => ({
  redis: {
    exists: vi.fn(async () => 0),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  },
}));
vi.mock("~/server/util/mailing", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("~/server/util/notificationRecipients", () => ({
  resolveNotificationRecipients: vi.fn(async () => ["owner@example.com"]),
}));
vi.mock("jwt-decode", () => ({
  jwtDecode: vi.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(
      async () =>
        new Promise(() => {
          /* hang — not expected to be reached in this test */
        }),
    ),
  },
}));

import { Fleet } from "~/server/util/fleet";
import { getNewTokenWithRefreshToken } from "~/server/util/auth";
import {
  getByEmail,
  upsert,
  recordRefreshError,
} from "~/server/util/routes/refreshToken";
import { redis } from "~/server/util/redis";
import { sendEmail } from "~/server/util/mailing";
import { resolveNotificationRecipients } from "~/server/util/notificationRecipients";

const mockGetNewToken = vi.mocked(getNewTokenWithRefreshToken);
const mockGetByEmail = vi.mocked(getByEmail);
const mockUpsert = vi.mocked(upsert);
const mockRecordRefreshError = vi.mocked(recordRefreshError);
const mockRedisExists = vi.mocked(redis.exists);
const mockRedisSet = vi.mocked(redis.set);
const mockRedisDel = vi.mocked(redis.del);
const mockSendEmail = vi.mocked(sendEmail);
const mockResolveRecipients = vi.mocked(resolveNotificationRecipients);

function tokenRecord(refreshToken: string) {
  return {
    id: "id-1",
    email: "any@example.com",
    refreshToken,
    expiresAt: new Date(),
    modifiedTime: new Date(),
    lastRefreshError: null,
    lastRefreshErrorAt: null,
  };
}

function okResponse(refreshToken: string) {
  return {
    ok: true,
    json: async () => ({
      access_token: "new-access-token",
      refresh_token: refreshToken,
    }),
  } as any;
}

function failResponse(status = 401, statusText = "Unauthorized") {
  return { ok: false, status, statusText } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisExists.mockResolvedValue(0 as any);
  mockRedisSet.mockResolvedValue("OK" as any);
  mockRedisDel.mockResolvedValue(1 as any);
});

describe("Fleet token refresh — self-heal and email dedup", () => {
  it("resyncs from the DB and retries once when the DB already holds a newer refresh token, without notifying anyone", async () => {
    const email = "resync-success@example.com";
    mockGetByEmail
      .mockResolvedValueOnce(tokenRecord("token-A"))
      .mockResolvedValueOnce(tokenRecord("token-B"));
    mockGetNewToken
      .mockResolvedValueOnce(failResponse())
      .mockResolvedValueOnce(okResponse("token-C"));

    const token = await Fleet.getInstance(email).getToken();

    expect(token).toBe("new-access-token");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email, refreshToken: "token-C" }),
    );
    expect(mockRedisDel).toHaveBeenCalledWith(`token_refresh_failed:${email}`);
    expect(mockResolveRecipients).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRecordRefreshError).not.toHaveBeenCalled();
  });

  it("notifies once and records the error when the DB still holds the same (genuinely dead) refresh token", async () => {
    const email = "genuine-failure@example.com";
    mockGetByEmail.mockResolvedValue(tokenRecord("token-A"));
    mockGetNewToken.mockResolvedValue(failResponse(400, "Bad Request"));
    mockRedisExists.mockResolvedValue(0 as any);

    await expect(Fleet.getInstance(email).getToken()).rejects.toThrow(
      "Failed to obtain new token with refresh token",
    );

    expect(mockResolveRecipients).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockRedisSet).toHaveBeenCalledWith(
      `token_refresh_failed:${email}`,
      "1",
    );
    expect(mockRecordRefreshError).toHaveBeenCalledWith(
      email,
      expect.stringContaining("Failed to obtain new token with refresh token"),
    );
  });

  it("suppresses the notification (but still records the error) once the dedup key is already set", async () => {
    const email = "already-notified@example.com";
    mockGetByEmail.mockResolvedValue(tokenRecord("token-A"));
    mockGetNewToken.mockResolvedValue(failResponse(400, "Bad Request"));
    mockRedisExists.mockResolvedValue(1 as any);

    await expect(Fleet.getInstance(email).getToken()).rejects.toThrow(
      "Failed to obtain new token with refresh token",
    );

    expect(mockResolveRecipients).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRecordRefreshError).toHaveBeenCalledTimes(1);
  });

  it("clears the failure dedup key on a plain successful refresh", async () => {
    const email = "plain-success@example.com";
    mockGetByEmail.mockResolvedValueOnce(tokenRecord("token-A"));
    mockGetNewToken.mockResolvedValueOnce(okResponse("token-B"));

    const token = await Fleet.getInstance(email).getToken();

    expect(token).toBe("new-access-token");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email, refreshToken: "token-B" }),
    );
    expect(mockRedisDel).toHaveBeenCalledWith(`token_refresh_failed:${email}`);
  });
});
