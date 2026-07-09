import { vi, describe, it, expect, beforeEach } from "vitest";

// Separate test file (rather than extending calibrationService.test.ts) so
// this gets its own AppDataSource mock that actually resolves — the shared
// file's datasource mock deliberately hangs forever to keep background job
// tests from reaching the DB, which finalizeCurveCalibration needs to do.

const mockSampleFind = vi.fn();
const mockCalibFindOne = vi.fn();
const mockCalibSave = vi.fn(async (entity: unknown) => entity);

vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(async () => ({
      getRepository: (name: string) =>
        name === "SiteCalibrationSample"
          ? { find: mockSampleFind }
          : { findOne: mockCalibFindOne, save: mockCalibSave },
    })),
  },
}));

const mockCandidate = {
  bins: Array.from({ length: 12 }, (_, i) => ({
    soc_percent: 80 + i,
    battery_kw: 16.3,
    sample_count: 10,
  })),
  total_sample_count: 120,
  soc_range_percent: 11,
  data_window_days: 2,
  built_at: "2026-07-02T05:20:29.828Z",
};

vi.mock("~/server/util/curveFit", () => ({
  buildChargeCurveBins: vi.fn(() => mockCandidate),
  isValidCandidate: vi.fn(() => true),
  SAMPLE_RETENTION_DAYS: 60,
  MAX_CURVE_START_SOC_PERCENT: 85,
}));

import { finalizeCurveCalibration } from "~/server/util/calibrationService";

beforeEach(() => {
  vi.clearAllMocks();
  mockSampleFind.mockResolvedValue([
    { creation_time: new Date().toISOString(), sample_data: {} },
  ]);
});

describe("finalizeCurveCalibration — upsert in place", () => {
  it("reuses the existing row's id instead of inserting a new row", async () => {
    mockCalibFindOne.mockResolvedValueOnce({
      id: "existing-curve-id",
      calibration_data: {},
    });

    await finalizeCurveCalibration("site-1");

    expect(mockCalibSave).toHaveBeenCalledTimes(1);
    expect(mockCalibSave.mock.calls[0][0]).toMatchObject({
      id: "existing-curve-id",
      site_id: "site-1",
      calibration_type: "chargeCurve",
    });
  });

  it("omits id (inserts) when no prior row exists for the site", async () => {
    mockCalibFindOne.mockResolvedValueOnce(null);

    await finalizeCurveCalibration("site-1");

    expect(mockCalibSave).toHaveBeenCalledTimes(1);
    expect(mockCalibSave.mock.calls[0][0]).not.toHaveProperty("id");
    expect(mockCalibSave.mock.calls[0][0]).toMatchObject({
      site_id: "site-1",
      calibration_type: "chargeCurve",
    });
  });
});
