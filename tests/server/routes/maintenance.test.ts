import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("~/server/util/routes/refreshToken", () => ({
  getByEmail: vi.fn(),
}));

// resolveActor (behind the new permission middleware) additionally looks up
// the login's own `users` row for delegation grants — mocked here to "no
// delegations" so these tests exercise a plain owner/bootstrap actor, same as
// before the permission system existed.
const mockUserFindOne = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({ findOne: mockUserFindOne }),
    }),
  },
}));

import { getByEmail } from "~/server/util/routes/refreshToken";

const mockedGetByEmail = vi.mocked(getByEmail);

async function loadRouter(
  env: { clientId?: string; authBaseUrl?: string } = {
    clientId: "test-client-id",
  },
) {
  if (env.clientId === undefined) {
    delete process.env.TESLA_CLIENT_ID;
  } else {
    process.env.TESLA_CLIENT_ID = env.clientId;
  }
  process.env.TESLA_AUTH_BASE_URL =
    env.authBaseUrl ?? "https://fleet-auth.example.com";
  vi.resetModules();
  const mod = await import("~/server/routes/maintenance");
  return mod.router as express.Router;
}

function buildApp(router: express.Router, sessionUser?: string) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = { user: sessionUser };
    next();
  });
  app.use("/api/maintenance", router);
  return app;
}

describe("maintenance routes", () => {
  beforeEach(() => {
    mockUserFindOne.mockResolvedValue(null);
  });

  afterEach(() => {
    // resetAllMocks (not clearAllMocks) — clearAllMocks only wipes call
    // history, not configured resolved/rejected values, so a prior test's
    // mockRejectedValue(...) on getByEmail would otherwise leak into later
    // tests now that resolveActor() calls it on every request.
    vi.resetAllMocks();
  });

  describe("GET /refresh-token/status", () => {
    it("returns 401 when not authenticated", async () => {
      const app = buildApp(await loadRouter(), undefined);
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(401);
    });

    it("returns hasToken:false when no record exists", async () => {
      mockedGetByEmail.mockResolvedValue(null);
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          email: "user@example.com",
          hasToken: false,
          stale: false,
          lastRefreshedAt: null,
          lastRefreshError: null,
          lastRefreshErrorAt: null,
        },
      });
    });

    it("returns stale:false and lastRefreshedAt when the access token is fresh", async () => {
      const modifiedTime = new Date("2026-01-01T00:00:00.000Z");
      mockedGetByEmail.mockResolvedValue({
        id: "id-1",
        email: "user@example.com",
        refreshToken: "super-secret-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in the future
        modifiedTime,
        lastRefreshError: null,
        lastRefreshErrorAt: null,
      });
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        email: "user@example.com",
        hasToken: true,
        stale: false,
        lastRefreshedAt: modifiedTime.toISOString(),
        lastRefreshError: null,
        lastRefreshErrorAt: null,
      });
      expect(JSON.stringify(res.body)).not.toContain("super-secret-token");
    });

    it("returns stale:true when the access token expired more than 2 hours ago", async () => {
      const modifiedTime = new Date("2026-01-01T00:00:00.000Z");
      mockedGetByEmail.mockResolvedValue({
        id: "id-1",
        email: "user@example.com",
        refreshToken: "super-secret-token",
        expiresAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h in the past
        modifiedTime,
        lastRefreshError: null,
        lastRefreshErrorAt: null,
      });
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(200);
      expect(res.body.data.stale).toBe(true);
    });

    it("surfaces lastRefreshError even when expires_at is still fresh (not masked by stale:false)", async () => {
      const modifiedTime = new Date("2026-01-01T00:00:00.000Z");
      const errorAt = new Date("2026-01-01T01:00:00.000Z");
      mockedGetByEmail.mockResolvedValue({
        id: "id-1",
        email: "user@example.com",
        refreshToken: "super-secret-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in the future — not stale
        modifiedTime,
        lastRefreshError:
          "Failed to obtain new token with refresh token: 400 Bad Request",
        lastRefreshErrorAt: errorAt,
      });
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(200);
      expect(res.body.data.stale).toBe(false);
      expect(res.body.data.lastRefreshError).toBe(
        "Failed to obtain new token with refresh token: 400 Bad Request",
      );
      expect(res.body.data.lastRefreshErrorAt).toBe(errorAt.toISOString());
    });

    it("returns 500 when the lookup throws", async () => {
      mockedGetByEmail.mockRejectedValue(new Error("db down"));
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(500);
    });
  });

  describe("POST /refresh-token/start", () => {
    it("returns 401 when not authenticated", async () => {
      const app = buildApp(await loadRouter(), undefined);
      const res = await request(app).post(
        "/api/maintenance/refresh-token/start",
      );
      expect(res.status).toBe(401);
    });

    it("returns 500 when TESLA_CLIENT_ID is not configured", async () => {
      const app = buildApp(await loadRouter({}), "user@example.com");
      const res = await request(app).post(
        "/api/maintenance/refresh-token/start",
      );
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("returns an authorize URL built from the request's own host", async () => {
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app)
        .post("/api/maintenance/refresh-token/start")
        .set("Host", "tpa.example.com");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const url = new URL(res.body.data.authorizeUrl);
      expect(url.origin).toBe("https://fleet-auth.example.com");
      expect(url.pathname).toBe("/oauth2/v3/authorize");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://tpa.example.com/callback",
      );
      expect(url.searchParams.get("state")).toBeTruthy();
    });

    it("prefers X-Forwarded-Host over Host when behind a reverse proxy", async () => {
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app)
        .post("/api/maintenance/refresh-token/start")
        .set("Host", "192.168.2.108:3001")
        .set("X-Forwarded-Host", "powerwall.example.com");

      expect(res.status).toBe(200);
      const url = new URL(res.body.data.authorizeUrl);
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://powerwall.example.com/callback",
      );
    });
  });
});
