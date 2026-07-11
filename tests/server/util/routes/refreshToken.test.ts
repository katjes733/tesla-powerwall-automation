import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/util/tokenCrypto", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decryptIfEncrypted: (v: string) => v.replace(/^enc:/, ""),
}));

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn();

vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(async () => ({
      getRepository: () => ({
        insert: mockInsert,
        update: mockUpdate,
        findOne: mockFindOne,
        find: mockFind,
      }),
    })),
  },
}));

import {
  upsert,
  recordRefreshError,
  getByEmail,
} from "~/server/util/routes/refreshToken";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOne.mockResolvedValue(null); // upsert's own getByEmail lookup for an existing id, unless overridden
});

describe("refreshToken route utils", () => {
  describe("upsert", () => {
    it("clears last_refresh_error/last_refresh_error_at on insert (new email)", async () => {
      const result = await upsert({
        email: "new@example.com",
        refreshToken: "token-A",
      });
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          last_refresh_error: null,
          last_refresh_error_at: null,
        }),
      );
      expect(result.data.lastRefreshError).toBeNull();
      expect(result.data.lastRefreshErrorAt).toBeNull();
    });

    it("clears last_refresh_error/last_refresh_error_at on update (existing email)", async () => {
      await upsert({
        id: "existing-id",
        email: "existing@example.com",
        refreshToken: "token-B",
      });
      expect(mockUpdate).toHaveBeenCalledWith(
        "existing-id",
        expect.objectContaining({
          last_refresh_error: null,
          last_refresh_error_at: null,
        }),
      );
    });
  });

  describe("recordRefreshError", () => {
    it("sets last_refresh_error and last_refresh_error_at for the given email", async () => {
      await recordRefreshError("broken@example.com", "boom");
      expect(mockUpdate).toHaveBeenCalledWith(
        { email: "broken@example.com" },
        expect.objectContaining({ last_refresh_error: "boom" }),
      );
      const [, payload] = mockUpdate.mock.calls[0];
      expect(payload.last_refresh_error_at).toBeInstanceOf(Date);
    });
  });

  describe("getByEmail", () => {
    it("returns lastRefreshError/lastRefreshErrorAt from the record", async () => {
      const errorAt = new Date("2026-01-01T00:00:00.000Z");
      mockFindOne.mockResolvedValue({
        id: "id-1",
        email: "broken@example.com",
        refresh_token: "enc:token-A",
        expires_at: new Date("2026-01-02T00:00:00.000Z"),
        modified_time: new Date("2026-01-01T00:00:00.000Z"),
        last_refresh_error: "Failed to obtain new token",
        last_refresh_error_at: errorAt,
      });

      const record = await getByEmail("broken@example.com");

      expect(record?.lastRefreshError).toBe("Failed to obtain new token");
      expect(record?.lastRefreshErrorAt).toBe(errorAt);
      expect(record?.refreshToken).toBe("token-A");
    });

    it("returns null lastRefreshError/lastRefreshErrorAt when never set", async () => {
      mockFindOne.mockResolvedValue({
        id: "id-1",
        email: "healthy@example.com",
        refresh_token: "enc:token-A",
        expires_at: new Date("2026-01-02T00:00:00.000Z"),
        modified_time: new Date("2026-01-01T00:00:00.000Z"),
        last_refresh_error: null,
        last_refresh_error_at: null,
      });

      const record = await getByEmail("healthy@example.com");

      expect(record?.lastRefreshError).toBeNull();
      expect(record?.lastRefreshErrorAt).toBeNull();
    });
  });
});
