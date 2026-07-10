import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Actor } from "~/server/util/actor";

let currentActor: Actor | undefined;
vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = currentActor;
    next();
  },
}));

const mockFindOne = vi.fn();
const mockUpdate = vi.fn();
const mockSave = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({
        findOne: mockFindOne,
        update: mockUpdate,
        save: mockSave,
      }),
    }),
  },
}));

async function buildApp() {
  vi.resetModules();
  const { router } = await import("~/server/routes/notificationPreferences");
  const app = express();
  app.use(express.json());
  app.use("/api/notification-preferences", router);
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

function delegateActor(overrides: Partial<Actor> = {}): Actor {
  return {
    loginEmail: "delegate@example.com",
    source: "delegate",
    accountEmail: "owner@example.com",
    profile: "write",
    siteIds: ["site-1", "site-2"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentActor = ownerActor();
});

describe("GET /api/notification-preferences", () => {
  it("403s for a read-profile actor", async () => {
    currentActor = delegateActor({ profile: "read" });
    const app = await buildApp();
    const res = await request(app).get("/api/notification-preferences");
    expect(res.status).toBe(403);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("defaults an owner to '*' for every type when nothing is stored", async () => {
    mockFindOne.mockResolvedValueOnce({ user_details: null });
    const app = await buildApp();
    const res = await request(app).get("/api/notification-preferences");
    expect(res.status).toBe(200);
    expect(res.body.data.calibration_events).toBe("*");
    expect(res.body.data.account_health).toBe("*");
  });

  it("defaults a delegate to [] for every type when nothing is stored", async () => {
    currentActor = delegateActor();
    mockFindOne.mockResolvedValueOnce({ user_details: null });
    const app = await buildApp();
    const res = await request(app).get("/api/notification-preferences");
    expect(res.status).toBe(200);
    expect(res.body.data.calibration_events).toEqual([]);
    expect(res.body.data.account_health).toEqual([]);
  });

  it("respects an explicitly-saved empty array instead of reapplying the owner default", async () => {
    mockFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    const app = await buildApp();
    const res = await request(app).get("/api/notification-preferences");
    expect(res.status).toBe(200);
    expect(res.body.data.calibration_events).toEqual([]);
  });
});

describe("PATCH /api/notification-preferences", () => {
  it("403s when a site-scoped delegate submits a site outside their scope for a site-scoped type", async () => {
    currentActor = delegateActor({ siteIds: ["site-1"] });
    const app = await buildApp();
    const res = await request(app)
      .patch("/api/notification-preferences")
      .send({ calibration_events: ["site-1", "site-99"] });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("403s when a site-scoped delegate submits '*' for a site-scoped type", async () => {
    currentActor = delegateActor({ siteIds: ["site-1"] });
    const app = await buildApp();
    const res = await request(app)
      .patch("/api/notification-preferences")
      .send({ calibration_events: "*" });
    expect(res.status).toBe(403);
  });

  it("does not 403 a site-scoped delegate submitting '*' for the account-wide type", async () => {
    currentActor = delegateActor({ siteIds: ["site-1"] });
    mockFindOne
      .mockResolvedValueOnce({ id: "u1", user_details: {} })
      .mockResolvedValueOnce({
        user_details: { notification_preferences: { account_health: "*" } },
      });
    const app = await buildApp();
    const res = await request(app)
      .patch("/api/notification-preferences")
      .send({ account_health: "*" });
    expect(res.status).toBe(200);
    expect(res.body.data.account_health).toBe("*");
  });

  it("shallow-merges into user_details without clobbering unrelated keys", async () => {
    mockFindOne
      .mockResolvedValueOnce({
        id: "u1",
        user_details: {
          some_other_feature: { unrelated: true },
          notification_preferences: { calibration_events: "*" },
        },
      })
      .mockResolvedValueOnce({
        user_details: {
          some_other_feature: { unrelated: true },
          notification_preferences: {
            calibration_events: "*",
            site_action_failures: ["site-1"],
          },
        },
      });
    const app = await buildApp();
    const res = await request(app)
      .patch("/api/notification-preferences")
      .send({ site_action_failures: ["site-1"] });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        user_details: expect.objectContaining({
          some_other_feature: { unrelated: true },
          notification_preferences: expect.objectContaining({
            calibration_events: "*",
            site_action_failures: ["site-1"],
          }),
        }),
      }),
    );
  });
});
