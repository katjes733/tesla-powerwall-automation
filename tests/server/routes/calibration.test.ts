import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Actor } from "~/server/util/actor";

// Scoped to GET /schedule-status only — the rest of calibration.ts's routes
// (job orchestration, Fleet calls, curve fitting) are exercised elsewhere and
// aren't touched by this endpoint.
let currentActor: Actor | undefined;
vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = currentActor;
    next();
  },
}));

const mockFindBy = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({ findBy: mockFindBy }),
    }),
  },
}));

async function buildApp() {
  vi.resetModules();
  const { router } = await import("~/server/routes/calibration");
  const app = express();
  app.use(express.json());
  app.use("/api/calibration", router);
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

function oneTimeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-1",
    email: "owner@example.com",
    site_ids: ["site-1"],
    cron: "30 14 12 8 *",
    timezone: "UTC",
    enabled: true,
    actions: [{ action: "calibrate_grid_charge_rate", value: "{}" }],
    conditions: [],
    options: { runOnce: true },
    creation_time: new Date("2026-01-01T00:00:00Z"),
    last_error: null,
    last_error_time: null,
    last_success_time: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentActor = ownerActor();
});

describe("GET /api/calibration/schedule-status", () => {
  it("400s when siteId is missing", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/calibration/schedule-status");
    expect(res.status).toBe(400);
    expect(mockFindBy).not.toHaveBeenCalled();
  });

  it("returns null for an action with no matching schedule", async () => {
    mockFindBy.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ gridChargeRate: null, curve: null });
  });

  it("reports phase 'pending' with nextRunAt for an enabled schedule", async () => {
    mockFindBy.mockResolvedValueOnce([oneTimeSchedule()]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.gridChargeRate).toMatchObject({
      id: "sched-1",
      phase: "pending",
      timezone: "UTC",
    });
    expect(res.body.data.gridChargeRate.nextRunAt).toBeDefined();
    expect(res.body.data.curve).toBeNull();
  });

  it("reports phase 'succeeded' when disabled with a last_success_time", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({
        enabled: false,
        last_success_time: new Date("2026-01-02T00:00:00Z"),
      }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toMatchObject({
      id: "sched-1",
      phase: "succeeded",
      lastSuccessTime: "2026-01-02T00:00:00.000Z",
    });
    expect(res.body.data.gridChargeRate.nextRunAt).toBeUndefined();
  });

  it("reports phase 'failed' when disabled with a last_error", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({
        enabled: false,
        last_error: "conditions not met: SOC too high",
        last_error_time: new Date("2026-01-02T00:00:00Z"),
      }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toMatchObject({
      id: "sched-1",
      phase: "failed",
      lastError: "conditions not met: SOC too high",
      lastErrorTime: "2026-01-02T00:00:00.000Z",
    });
  });

  it("reports phase 'expired' when disabled with neither success nor error", async () => {
    mockFindBy.mockResolvedValueOnce([oneTimeSchedule({ enabled: false })]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toMatchObject({
      id: "sched-1",
      phase: "expired",
    });
  });

  it("picks the most recently created schedule when duplicates exist", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({
        id: "sched-old",
        creation_time: new Date("2026-01-01T00:00:00Z"),
        enabled: false,
      }),
      oneTimeSchedule({
        id: "sched-new",
        creation_time: new Date("2026-01-05T00:00:00Z"),
      }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate.id).toBe("sched-new");
    expect(res.body.data.gridChargeRate.phase).toBe("pending");
  });

  it("ignores schedules that are not runOnce", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({ options: null }),
      oneTimeSchedule({ options: { runOnce: false } }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toBeNull();
  });

  it("ignores schedules scoped to a different site", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({ site_ids: ["site-2"] }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toBeNull();
  });

  it("keeps gridChargeRate and curve independent", async () => {
    mockFindBy.mockResolvedValueOnce([
      oneTimeSchedule({
        id: "sched-grid",
        actions: [{ action: "calibrate_grid_charge_rate", value: "{}" }],
      }),
      oneTimeSchedule({
        id: "sched-curve",
        actions: [{ action: "calibrate_charge_curve", value: "{}" }],
        enabled: false,
        last_success_time: new Date("2026-01-02T00:00:00Z"),
      }),
    ]);
    const app = await buildApp();
    const res = await request(app).get(
      "/api/calibration/schedule-status?siteId=site-1",
    );
    expect(res.body.data.gridChargeRate).toMatchObject({
      id: "sched-grid",
      phase: "pending",
    });
    expect(res.body.data.curve).toMatchObject({
      id: "sched-curve",
      phase: "succeeded",
    });
  });
});
