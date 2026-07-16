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

const mockGetEnergyProducts = vi.fn();
vi.mock("~/server/util/fleet", () => ({
  Fleet: { getInstance: () => ({ getEnergyProducts: mockGetEnergyProducts }) },
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
  const { router } = await import("~/server/routes/siteSettings");
  const app = express();
  app.use(express.json());
  app.use("/api/site-settings", router);
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

beforeEach(() => {
  vi.clearAllMocks();
  currentActor = ownerActor();
  mockGetEnergyProducts.mockResolvedValue([
    { energy_site_id: 42, site_name: "Test Site" },
  ]);
});

describe("PATCH /api/site-settings — location", () => {
  it("geocodes a valid ZIP and persists the resolved lat/lon", async () => {
    mockFindOne
      .mockResolvedValueOnce(null) // existing lookup before write
      .mockResolvedValueOnce({
        settings: {
          location_zip: "85001",
          location_lat: 33.4484,
          location_lon: -112.074,
        },
      }); // re-fetch after write

    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({ siteId: "42", settings: { location_zip: "85001" } });

    expect(res.status).toBe(200);
    expect(res.body.data.location_zip).toBe("85001");
    expect(res.body.data.location_lat).toBeCloseTo(33.4484, 4);
    expect(res.body.data.location_lon).toBeCloseTo(-112.074, 4);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          location_zip: "85001",
          location_lat: 33.4484,
          location_lon: -112.074,
        }),
      }),
    );
  });

  it("rejects an unrecognized ZIP with 400 and never touches the DB", async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({ siteId: "42", settings: { location_zip: "00000" } });

    expect(res.status).toBe(400);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("leaves a previously-saved location untouched when a later PATCH's ZIP fails", async () => {
    // Simulate: site already has a good location saved. A bad-ZIP PATCH
    // must not reach the DB at all, so a follow-up GET still returns the
    // original value untouched.
    mockFindOne.mockResolvedValue({
      settings: {
        location_zip: "85001",
        location_lat: 33.4484,
        location_lon: -112.074,
      },
    });

    const app = await buildApp();
    const badPatch = await request(app)
      .patch("/api/site-settings")
      .send({ siteId: "42", settings: { location_zip: "00000" } });
    expect(badPatch.status).toBe(400);

    const get = await request(app)
      .get("/api/site-settings")
      .query({ siteId: "42" });
    expect(get.body.data.location_zip).toBe("85001");
  });

  it("accepts direct lat/lon (browser geolocation) and clears location_zip", async () => {
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      settings: {
        location_zip: null,
        location_lat: 40.1,
        location_lon: -105.2,
      },
    });

    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({
        siteId: "42",
        settings: { location_lat: 40.1, location_lon: -105.2 },
      });

    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          location_zip: null,
          location_lat: 40.1,
          location_lon: -105.2,
        }),
      }),
    );
  });

  it("clears all three location fields when location_zip is explicitly set to null", async () => {
    mockFindOne
      .mockResolvedValueOnce({
        id: "row-1",
        settings: {
          location_zip: "85001",
          location_lat: 33.4484,
          location_lon: -112.074,
        },
      })
      .mockResolvedValueOnce({
        settings: {
          location_zip: null,
          location_lat: null,
          location_lon: null,
        },
      });

    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({ siteId: "42", settings: { location_zip: null } });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        settings: expect.objectContaining({
          location_zip: null,
          location_lat: null,
          location_lon: null,
        }),
      }),
    );
  });
});

describe("PATCH /api/site-settings — location is admin-only (maintenance.siteLocation)", () => {
  it("rejects a non-admin write-profile actor with 403 and never touches the DB", async () => {
    currentActor = ownerActor({ profile: "write" });

    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({ siteId: "42", settings: { location_zip: "85001" } });

    expect(res.status).toBe(403);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("still allows a non-admin write-profile actor to toggle auto_curve_calibration_enabled", async () => {
    currentActor = ownerActor({ profile: "write" });
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      settings: { auto_curve_calibration_enabled: false },
    });

    const app = await buildApp();
    const res = await request(app)
      .patch("/api/site-settings")
      .send({
        siteId: "42",
        settings: { auto_curve_calibration_enabled: false },
      });

    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalled();
  });
});
