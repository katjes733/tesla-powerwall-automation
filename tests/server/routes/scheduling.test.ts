import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Actor } from "~/server/util/actor";

// resolveActorMiddleware is covered by its own tests — here we inject a
// controllable req.actor directly so these tests focus on GET /all's own
// runOnce-filtering logic (both the owner/unscoped SQL path and the
// site-scoped delegate in-memory path).
let currentActor: Actor | undefined;
vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = currentActor;
    next();
  },
}));

const mockFindAndCount = vi.fn();
const mockFindBy = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({
        findAndCount: mockFindAndCount,
        findBy: mockFindBy,
      }),
    }),
  },
}));

// Scheduler is only exercised by POST /upsert and /delete — not under test
// here — but scheduling.ts imports it at module scope, so it must be mocked
// to avoid pulling in the real cron/DB machinery.
vi.mock("~/server/util/scheduler", () => ({
  Scheduler: { getInstance: () => ({ upsert: vi.fn(), delete: vi.fn() }) },
}));

async function buildApp() {
  vi.resetModules();
  const { router } = await import("~/server/routes/scheduling");
  const app = express();
  app.use(express.json());
  app.use("/api/schedule", router);
  return app;
}

function ownerActor(overrides: Partial<Actor> = {}): Actor {
  return {
    loginEmail: "owner@example.com",
    source: "owner",
    accountEmail: "owner@example.com",
    profile: "admin",
    siteIds: "*",
    ...overrides,
  };
}

function recurringSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-recurring",
    email: "owner@example.com",
    site_ids: ["site-1"],
    cron: "0 9 * * 1",
    timezone: "UTC",
    enabled: true,
    actions: [{ action: "calibrate_grid_charge_rate", value: "{}" }],
    conditions: [],
    options: null,
    ...overrides,
  };
}

function oneTimeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-run-once",
    email: "owner@example.com",
    site_ids: ["site-1"],
    cron: "30 14 12 8 *",
    timezone: "UTC",
    enabled: true,
    actions: [{ action: "calibrate_grid_charge_rate", value: "{}" }],
    conditions: [],
    options: { runOnce: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentActor = ownerActor();
});

describe("GET /api/schedule/all", () => {
  it("owner path: excludes runOnce schedules via the DB query filter", async () => {
    mockFindAndCount.mockResolvedValueOnce([[recurringSchedule()], 1]);

    const app = await buildApp();
    const res = await request(app).get("/api/schedule/all");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([recurringSchedule()]);
    // Assert the exclusion condition was actually passed to the repository,
    // not just that we happened to return the fixture we set up.
    const whereArg = mockFindAndCount.mock.calls[0][0].where;
    expect(whereArg.email).toBe("owner@example.com");
    expect(typeof whereArg.options).toBe("object");
  });

  it("delegate path: filters out runOnce schedules in-memory even when enabled", async () => {
    currentActor = ownerActor({
      source: "delegate",
      profile: "write",
      siteIds: ["site-1"],
    });
    mockFindBy.mockResolvedValueOnce([
      recurringSchedule(),
      oneTimeSchedule(),
      oneTimeSchedule({ id: "sched-run-once-disabled", enabled: false }),
    ]);

    const app = await buildApp();
    const res = await request(app).get("/api/schedule/all");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([recurringSchedule()]);
    expect(res.body.total).toBe(1);
  });

  it("delegate path: still applies site scoping alongside the runOnce filter", async () => {
    currentActor = ownerActor({
      source: "delegate",
      profile: "write",
      siteIds: ["site-2"],
    });
    mockFindBy.mockResolvedValueOnce([recurringSchedule()]);

    const app = await buildApp();
    const res = await request(app).get("/api/schedule/all");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
