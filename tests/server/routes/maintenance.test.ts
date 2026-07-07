import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("~/server/util/routes/refreshToken", () => ({
  getByEmail: vi.fn(),
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
  afterEach(() => {
    vi.clearAllMocks();
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
        data: { email: "user@example.com", hasToken: false, expiresAt: null },
      });
    });

    it("returns token info without exposing the raw refresh token", async () => {
      const expiresAt = new Date("2026-01-01T00:00:00.000Z");
      mockedGetByEmail.mockResolvedValue({
        id: "id-1",
        email: "user@example.com",
        refreshToken: "super-secret-token",
        expiresAt,
      });
      const app = buildApp(await loadRouter(), "user@example.com");
      const res = await request(app).get(
        "/api/maintenance/refresh-token/status",
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        email: "user@example.com",
        hasToken: true,
        expiresAt: expiresAt.toISOString(),
      });
      expect(JSON.stringify(res.body)).not.toContain("super-secret-token");
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
  });
});
