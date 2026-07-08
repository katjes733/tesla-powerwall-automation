import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import argon2 from "argon2";

vi.mock("~/server/middleware/rateLimiter", () => ({
  loginLimiter: (_req: any, _res: any, next: any) => next(),
}));

const mockUserFindOneBy = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({ findOneBy: mockUserFindOneBy }),
    }),
  },
}));

const mockRedisGet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisDel = vi.fn();
vi.mock("~/server/util/redis", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));

const mockGetPendingSignup = vi.fn();
vi.mock("~/server/util/pendingSignup", () => ({
  getPendingSignup: (...args: unknown[]) => mockGetPendingSignup(...args),
}));

const mockResolveActor = vi.fn();
vi.mock("~/server/util/resolveActor", () => ({
  resolveActor: (...args: unknown[]) => mockResolveActor(...args),
}));

// Dynamically imported (after resetModules, per test) — session.ts calls
// logger.child() at module scope, so a static top-level import would
// evaluate it before tests/setup.ts's beforeEach installs the logger stub.
async function buildApp() {
  vi.resetModules();
  const { router } = await import("~/server/routes/session");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      cookie: {},
      destroy: (cb: (_err?: unknown) => void) => cb(),
    };
    next();
  });
  app.use("/api/session", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null); // not locked out, by default
});

describe("POST /login", () => {
  it("429s when the account is locked out, without checking credentials at all", async () => {
    mockRedisGet.mockResolvedValue("5");
    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "user@example.com", password: "whatever" });
    expect(res.status).toBe(429);
    expect(mockUserFindOneBy).not.toHaveBeenCalled();
    expect(mockGetPendingSignup).not.toHaveBeenCalled();
  });

  it("logs in an existing Postgres user with the correct password", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockUserFindOneBy.mockResolvedValue({
      id: "u1",
      email: "owner@example.com",
      password_hash: passwordHash,
    });
    mockResolveActor.mockResolvedValue({
      loginEmail: "owner@example.com",
      source: "owner",
      accountEmail: "owner@example.com",
      profile: "admin",
      siteIds: "*",
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "owner@example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      loginEmail: "owner@example.com",
      accountLinked: true,
    });
    // Never falls through to the Redis pending-signup path when a real row exists.
    expect(mockGetPendingSignup).not.toHaveBeenCalled();
  });

  it("401s an existing Postgres user with the wrong password", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockUserFindOneBy.mockResolvedValue({
      id: "u1",
      email: "owner@example.com",
      password_hash: passwordHash,
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "owner@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(mockRedisIncr).toHaveBeenCalled(); // records the failed attempt
  });

  it("logs in a pending (Redis-only) self-signup that hasn't linked Tesla yet", async () => {
    mockUserFindOneBy.mockResolvedValue(null);
    const passwordHash = await argon2.hash("new-password");
    mockGetPendingSignup.mockResolvedValue({ passwordHash });
    mockResolveActor.mockResolvedValue({ error: "no_access" });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "new@example.com", password: "new-password" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      loginEmail: "new@example.com",
      teslaAccountEmail: "new@example.com",
      accountType: "owner",
      profile: "admin",
      siteIds: "*",
      accountLinked: false,
    });
  });

  it("401s a pending signup login attempt with the wrong password", async () => {
    mockUserFindOneBy.mockResolvedValue(null);
    const passwordHash = await argon2.hash("new-password");
    mockGetPendingSignup.mockResolvedValue({ passwordHash });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "new@example.com", password: "wrong-guess" });

    expect(res.status).toBe(401);
  });

  it("401s when the email matches neither a Postgres user nor a pending signup", async () => {
    mockUserFindOneBy.mockResolvedValue(null);
    mockGetPendingSignup.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "nobody@example.com", password: "whatever" });

    expect(res.status).toBe(401);
  });

  it("prefers the real Postgres row over a stale Redis pending signup for the same email", async () => {
    const realHash = await argon2.hash("real-password");
    mockUserFindOneBy.mockResolvedValue({
      id: "u1",
      email: "raced@example.com",
      password_hash: realHash,
    });
    mockResolveActor.mockResolvedValue({
      loginEmail: "raced@example.com",
      source: "owner",
      accountEmail: "raced@example.com",
      profile: "admin",
      siteIds: "*",
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/session/login")
      .send({ email: "raced@example.com", password: "real-password" });

    expect(res.status).toBe(200);
    // The Redis lookup must never even run once a Postgres row is found.
    expect(mockGetPendingSignup).not.toHaveBeenCalled();
  });
});

describe("GET /me", () => {
  it("401s with no session", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/session/me");
    expect(res.status).toBe(401);
  });
});
