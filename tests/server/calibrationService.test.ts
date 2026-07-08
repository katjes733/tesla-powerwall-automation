import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockGetEnergyProducts,
  mockGetLiveStatus,
  mockGetSiteInfo,
  mockSetGridCharging,
  mockRedis,
} = vi.hoisted(() => ({
  mockGetEnergyProducts: vi.fn(),
  mockGetLiveStatus: vi.fn(),
  mockGetSiteInfo: vi.fn(),
  mockSetGridCharging: vi.fn(async () => {}),
  mockRedis: { setex: vi.fn(async () => "OK") },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/util/mailing", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: mockRedis }));
vi.mock("~/server/util/fleet", () => ({
  Fleet: {
    getInstance: vi.fn(() => ({
      getEnergyProducts: mockGetEnergyProducts,
      getLiveStatus: mockGetLiveStatus,
      getSiteInfo: mockGetSiteInfo,
      setGridCharging: mockSetGridCharging,
    })),
  },
}));
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(
      async () =>
        new Promise(() => {
          /* hang — background job never reaches DB in unit tests */
        }),
    ),
  },
}));
vi.mock("~/server/util/curveFit", () => ({
  buildChargeCurveBins: vi.fn(() => null),
  blendChargeCurveBins: vi.fn(() => null),
  isValidCandidate: vi.fn(() => false),
  SAMPLE_RETENTION_DAYS: 60,
  MAX_CURVE_START_SOC_PERCENT: 85,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  isCalibrationRunningForSite,
  triggerGridChargeRateCalibration,
  triggerChargeCurveCalibration,
  calibrationJobBySite,
  curveJobBySite,
  MAX_GRID_RATE_SOC_PERCENT,
  MAX_CURVE_CALIBRATION_SOC_PERCENT,
  MAX_SOLAR_KW,
  computeOneTimeSchedulePhase,
  computeOneTimeScheduleNextRun,
} from "~/server/util/calibrationService";
import type { ISchedule } from "~/server/database/models/schedule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITE_ID = "42";

const PRODUCT = { energy_site_id: 42, id: "prod-1" };

/** Live status that satisfies all grid-charge-rate conditions */
const LIVE_OK_GRID_RATE = {
  percentage_charged: MAX_GRID_RATE_SOC_PERCENT - 1,
  solar_power: (MAX_SOLAR_KW - 0.05) * 1000,
  island_status: "on_grid",
  battery_power: -500,
  grid_power: 1000,
};

/** Live status that satisfies all charge-curve conditions */
const LIVE_OK_CURVE = {
  percentage_charged: MAX_CURVE_CALIBRATION_SOC_PERCENT - 1,
  solar_power: 0,
  island_status: "on_grid",
  battery_power: -500,
  grid_power: 1000,
};

/** Site info with no TOU → always off-peak */
const SITE_INFO_NO_TOU = {
  installation_time_zone: "UTC",
  tariff_content: null,
  components: { disallow_charge_from_grid_with_solar_installed: false },
};

// ---------------------------------------------------------------------------
// isCalibrationRunningForSite
// ---------------------------------------------------------------------------

describe("isCalibrationRunningForSite", () => {
  beforeEach(() => {
    calibrationJobBySite.clear();
    curveJobBySite.clear();
  });

  it("returns false when both maps are empty", () => {
    expect(isCalibrationRunningForSite(SITE_ID)).toBe(false);
  });

  it("returns true when calibrationJobBySite has the site", () => {
    calibrationJobBySite.set(SITE_ID, "job-1");
    expect(isCalibrationRunningForSite(SITE_ID)).toBe(true);
  });

  it("returns true when curveJobBySite has the site (cross-type guard)", () => {
    curveJobBySite.set(SITE_ID, "job-2");
    expect(isCalibrationRunningForSite(SITE_ID)).toBe(true);
  });

  it("returns false for a different site even when maps are non-empty", () => {
    calibrationJobBySite.set("other-site", "job-3");
    curveJobBySite.set("another-site", "job-4");
    expect(isCalibrationRunningForSite(SITE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// triggerGridChargeRateCalibration — error paths
// ---------------------------------------------------------------------------

describe("triggerGridChargeRateCalibration — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calibrationJobBySite.clear();
    curveJobBySite.clear();
    mockGetEnergyProducts.mockResolvedValue([PRODUCT]);
    mockGetLiveStatus.mockResolvedValue(LIVE_OK_GRID_RATE);
    mockGetSiteInfo.mockResolvedValue(SITE_INFO_NO_TOU);
  });

  it("throws when site is not found in products", async () => {
    mockGetEnergyProducts.mockResolvedValue([]);
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow(`Site ${SITE_ID} not found`);
  });

  it("throws when a grid-rate calibration is already running for the site", async () => {
    calibrationJobBySite.set(SITE_ID, "existing-job");
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("already in progress");
  });

  it("throws when a curve calibration is already running (cross-type guard)", async () => {
    curveJobBySite.set(SITE_ID, "existing-curve-job");
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("already in progress");
  });

  it("throws when SOC is at or above the threshold", async () => {
    mockGetLiveStatus.mockResolvedValue({
      ...LIVE_OK_GRID_RATE,
      percentage_charged: MAX_GRID_RATE_SOC_PERCENT,
    });
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("conditions not met");
  });

  it("throws when solar is at or above the threshold", async () => {
    mockGetLiveStatus.mockResolvedValue({
      ...LIVE_OK_GRID_RATE,
      solar_power: MAX_SOLAR_KW * 1000,
    });
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("conditions not met");
  });

  it("throws when system is islanded (off-grid)", async () => {
    mockGetLiveStatus.mockResolvedValue({
      ...LIVE_OK_GRID_RATE,
      island_status: "island_mode",
    });
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("conditions not met");
  });

  it("throws when live status is unavailable", async () => {
    mockGetLiveStatus.mockResolvedValue(null);
    await expect(
      triggerGridChargeRateCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("unavailable");
  });
});

// ---------------------------------------------------------------------------
// triggerGridChargeRateCalibration — success path
// ---------------------------------------------------------------------------

describe("triggerGridChargeRateCalibration — success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calibrationJobBySite.clear();
    curveJobBySite.clear();
    mockGetEnergyProducts.mockResolvedValue([PRODUCT]);
    mockGetLiveStatus.mockResolvedValue(LIVE_OK_GRID_RATE);
    mockGetSiteInfo.mockResolvedValue(SITE_INFO_NO_TOU);
  });

  it("enables grid charging and registers the site in calibrationJobBySite", async () => {
    await triggerGridChargeRateCalibration(SITE_ID, "user@example.com");
    expect(mockSetGridCharging).toHaveBeenCalledWith(PRODUCT, "enabled");
    expect(calibrationJobBySite.has(SITE_ID)).toBe(true);
  });

  afterEach(() => {
    calibrationJobBySite.clear();
  });
});

// ---------------------------------------------------------------------------
// triggerChargeCurveCalibration — error paths
// ---------------------------------------------------------------------------

describe("triggerChargeCurveCalibration — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calibrationJobBySite.clear();
    curveJobBySite.clear();
    mockGetEnergyProducts.mockResolvedValue([PRODUCT]);
    mockGetLiveStatus.mockResolvedValue(LIVE_OK_CURVE);
    mockGetSiteInfo.mockResolvedValue(SITE_INFO_NO_TOU);
  });

  it("throws when site is not found in products", async () => {
    mockGetEnergyProducts.mockResolvedValue([]);
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow(`Site ${SITE_ID} not found`);
  });

  it("throws when a curve calibration is already running for the site", async () => {
    curveJobBySite.set(SITE_ID, "existing-curve-job");
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("already in progress");
  });

  it("throws when a grid-rate calibration is already running (cross-type guard)", async () => {
    calibrationJobBySite.set(SITE_ID, "existing-grid-job");
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("already in progress");
  });

  it("throws when SOC is at or above the curve threshold", async () => {
    mockGetLiveStatus.mockResolvedValue({
      ...LIVE_OK_CURVE,
      percentage_charged: MAX_CURVE_CALIBRATION_SOC_PERCENT,
    });
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("conditions not met");
  });

  it("throws when system is islanded (off-grid)", async () => {
    mockGetLiveStatus.mockResolvedValue({
      ...LIVE_OK_CURVE,
      island_status: "island_mode",
    });
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("conditions not met");
  });

  it("throws when live status is unavailable", async () => {
    mockGetLiveStatus.mockResolvedValue(null);
    await expect(
      triggerChargeCurveCalibration(SITE_ID, "user@example.com"),
    ).rejects.toThrow("unavailable");
  });
});

// ---------------------------------------------------------------------------
// triggerChargeCurveCalibration — success path
// ---------------------------------------------------------------------------

describe("triggerChargeCurveCalibration — success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calibrationJobBySite.clear();
    curveJobBySite.clear();
    mockGetEnergyProducts.mockResolvedValue([PRODUCT]);
    mockGetLiveStatus.mockResolvedValue(LIVE_OK_CURVE);
    mockGetSiteInfo.mockResolvedValue(SITE_INFO_NO_TOU);
  });

  it("enables grid charging and registers the site in curveJobBySite", async () => {
    await triggerChargeCurveCalibration(SITE_ID, "user@example.com");
    expect(mockSetGridCharging).toHaveBeenCalledWith(PRODUCT, "enabled");
    expect(curveJobBySite.has(SITE_ID)).toBe(true);
  });

  afterEach(() => {
    curveJobBySite.clear();
  });
});

// ---------------------------------------------------------------------------
// computeOneTimeSchedulePhase / computeOneTimeScheduleNextRun
// ---------------------------------------------------------------------------

function makeOneTimeSchedule(overrides: Partial<ISchedule> = {}): ISchedule {
  return {
    email: "user@example.com",
    site_ids: ["1"],
    cron: "0 12 1 1 *",
    timezone: "UTC",
    enabled: false,
    ...overrides,
  };
}

describe("computeOneTimeSchedulePhase", () => {
  it("returns pending while still enabled (hasn't fired yet)", () => {
    expect(
      computeOneTimeSchedulePhase(makeOneTimeSchedule({ enabled: true })),
    ).toBe("pending");
  });

  it("returns succeeded when disabled with a last_success_time", () => {
    expect(
      computeOneTimeSchedulePhase(
        makeOneTimeSchedule({ enabled: false, last_success_time: new Date() }),
      ),
    ).toBe("succeeded");
  });

  it("returns failed when disabled with a last_error and no last_success_time", () => {
    expect(
      computeOneTimeSchedulePhase(
        makeOneTimeSchedule({ enabled: false, last_error: "boom" }),
      ),
    ).toBe("failed");
  });

  it("returns expired when disabled with neither a success nor an error recorded", () => {
    expect(
      computeOneTimeSchedulePhase(makeOneTimeSchedule({ enabled: false })),
    ).toBe("expired");
  });
});

describe("computeOneTimeScheduleNextRun", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs the target date within the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const result = computeOneTimeScheduleNextRun("30 14 12 8 *", "UTC");
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(7); // August, 0-indexed
    expect(result.getUTCDate()).toBe(12);
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCMinutes()).toBe(30);
  });

  it("rolls over to next year when the target date has already passed this year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T00:00:00Z"));
    const result = computeOneTimeScheduleNextRun("0 9 1 1 *", "UTC");
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });
});
