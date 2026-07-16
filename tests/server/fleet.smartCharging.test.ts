import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import moment from "moment-timezone";

// ---------------------------------------------------------------------------
// Module mocks — setSmartGridCharging only reaches these on error paths in
// this test (grid charging is mocked to succeed), but mock defensively to
// match this codebase's established pattern for testing fleet.ts-adjacent
// code (see calibrationService.test.ts).
// ---------------------------------------------------------------------------

vi.mock("~/server/util/mailing", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/util/redis", () => ({
  redis: { setex: vi.fn(async () => "OK"), get: vi.fn(async () => null) },
}));
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(
      async () =>
        new Promise(() => {
          /* hang — not expected to be reached in this test */
        }),
    ),
  },
}));

import { Fleet } from "~/server/util/fleet";
import type { IScheduleCondition } from "~/server/database/models/schedule";
import type { Product } from "~/server/types/common";

const TZ = "America/Denver";
const PRODUCT: Product = {
  id: "prod-1",
  site_name: "Test Site",
  device_type: "energy",
  energy_site_id: 42,
  gateway_id: "gw-1",
};

// on-peak 13:45–21:00, every day — day-of-week left wide open so the exact
// calendar date used below doesn't matter.
const TARIFF = {
  utility_rates: {
    seasons: {
      summer: {
        fromMonth: 1,
        fromDay: 1,
        toMonth: 12,
        toDay: 31,
        tou_periods: {
          on_peak: [
            {
              fromDayOfWeek: 0,
              toDayOfWeek: 6,
              fromHour: 13,
              fromMinute: 45,
              toHour: 21,
              toMinute: 0,
            },
          ],
        },
      },
    },
  },
};

// Seasonal grid-charge window allowed 00:00–13:30 — closes 15 minutes before
// on-peak starts, mirroring the reported bug (window closes at 13:30,
// on-peak starts at 13:45).
const CONDITIONS: IScheduleCondition[] = [
  {
    condition: "inSeasonalGridChargeWindow",
    value: [{ seasonName: "summer", from: "00:00", to: "13:30" }],
  },
];

const SITE_INFO = {
  installation_time_zone: TZ,
  tariff_content: TARIFF,
  components: {
    disallow_charge_from_grid_with_solar_installed: false, // currently allowed/on
    batteries: [
      { part_name: "Powerwall 2", is_active: true, nameplate_energy: 13_500 },
    ],
  },
};

const LIVE_STATUS = {
  percentage_charged: 50,
  solar_power: 0,
  load_power: 0,
  battery_power: 0,
  island_status: "on_grid",
  grid_power: 0,
  generation_power: 0,
  wall_connectors: {},
  grid_status: "Active",
  storm_mode_active: false,
};

// Same as LIVE_STATUS but with non-zero solar so the linear-fallback solar
// estimate is non-zero — needed to observe a radiation-ratio adjustment,
// since ratio * 0 is still 0.
const LIVE_STATUS_WITH_SOLAR = {
  ...LIVE_STATUS,
  solar_power: 6000,
  load_power: 1000,
};

describe("setSmartGridCharging — disable when the charge window closes", () => {
  const originalDryRun = process.env.DRY_RUN;

  beforeEach(() => {
    process.env.DRY_RUN = "false";
  });

  afterEach(() => {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    vi.restoreAllMocks();
  });

  it("disables grid charging once the seasonal window closes, even though on-peak hasn't started yet", async () => {
    const fleet = Fleet.getInstance(
      `smart-charging-window-test-${Date.now()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    // now = 13:35: past the 13:30 window close, but before the 13:45 peak —
    // this is exactly the "outside allowed window" branch, reached because
    // the theoretical latest-grid-start time (peak - buffer - charge
    // duration) is earlier than now, same as the user's real report.
    const now = moment.tz("2026-07-13 13:35", TZ);

    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(SITE_INFO as any);
    vi.spyOn(fleet, "getLiveStatus").mockResolvedValue(LIVE_STATUS as any);
    vi.spyOn(fleet, "getSolarHistory").mockResolvedValue([]);
    vi.spyOn(fleet as any, "getCalibration").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getChargeCurve").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getSiteLocation").mockResolvedValue(null);
    const setGridChargingSpy = vi
      .spyOn(fleet, "setGridCharging")
      .mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(now.toDate());

    const result = await fleet.setSmartGridCharging(
      PRODUCT,
      JSON.stringify({ targetSoc: 90 }),
      CONDITIONS,
    );

    vi.useRealTimers();

    expect(result?.desired).toBe("disabled");
    expect(result?.action).toBe("disabled");
    expect(result?.situation).toBe("blocked_window");
    expect(result?.reason).toContain("outside allowed window");
    expect(result?.reason).toContain("closes 13:30");
    // The actual regression: grid charging must be turned off, not left
    // running past the window close until the next on-peak tick.
    expect(setGridChargingSpy).toHaveBeenCalledWith(PRODUCT, "disabled");
    // Window is blocked → achievable grid contribution is 0, so the
    // predicted SOC by peak is just current SOC (no solar in this fixture),
    // well short of the 90% target — visible proof of the shortfall.
    expect(result?.predictedSocAtPeak).toBe(50);
    expect(result?.targetGapPct).toBe(40);
    // The window is a daily 00:00–13:30 recurrence with no day-of-week
    // restriction — it reopens tomorrow at 00:00 in the site's own
    // timezone, not the server's local time or UTC.
    expect(result?.windowReopensAt).toBe(
      moment.tz("2026-07-14 00:00", TZ).toISOString(),
    );
  });
});

describe("setSmartGridCharging — plans around the window's close time, not just peak", () => {
  const originalDryRun = process.env.DRY_RUN;

  beforeEach(() => {
    process.env.DRY_RUN = "false";
  });

  afterEach(() => {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    vi.restoreAllMocks();
  });

  it("anchors latestGridStart to the window's close time when it's earlier than peak", async () => {
    const fleet = Fleet.getInstance(
      `smart-charging-window-plan-test-${Date.now()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    // Window closes at noon, well ahead of the 13:45 on-peak start — a wider
    // gap than the reported bug, so the two possible anchors land far apart
    // and the assertion isn't sensitive to minor timing.
    const conditions: IScheduleCondition[] = [
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "12:00" }],
      },
    ];
    // 50% → 90% on a 13.5kWh PW2 (4kW effective rate, no calibration/curve)
    // needs energyNeededKwh=5.4kWh, entirely below the CV taper zone (which
    // starts at 95%), so calculateGridChargeHours takes the flat-rate path:
    // 5.4/4h + the 2-minute startup buffer = 83 minutes exactly.
    const now = moment.tz("2026-07-13 10:00", TZ);

    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(SITE_INFO as any);
    vi.spyOn(fleet, "getLiveStatus").mockResolvedValue({
      ...LIVE_STATUS,
      percentage_charged: 50,
    } as any);
    vi.spyOn(fleet, "getSolarHistory").mockResolvedValue([]);
    vi.spyOn(fleet as any, "getCalibration").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getChargeCurve").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getSiteLocation").mockResolvedValue(null);
    vi.spyOn(fleet, "setGridCharging").mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(now.toDate());

    const result = await fleet.setSmartGridCharging(
      PRODUCT,
      JSON.stringify({ targetSoc: 90 }),
      conditions,
    );

    vi.useRealTimers();

    expect(result?.situation).toBe("waiting");
    // Regression: latestGridStart must be anchored to the window's close
    // (12:00 − 5min buffer − 83min charge time = 10:32), not to on-peak
    // start (13:45 − 5min buffer − 83min = 12:17) — the window closes
    // first today, so it's the true constraint on available charging time.
    // Before the fix, this would have read 12:17.
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-13 10:32", TZ).toISOString(),
    );
  });
});

describe("setSmartGridCharging — shortwave radiation ratio adjusts the solar estimate", () => {
  const originalDryRun = process.env.DRY_RUN;

  // Window closes at noon, on-peak starts 13:45 — same shape as the window-
  // anchoring test above, but with non-zero solar so a radiation ratio has
  // something to act on. now=10:00 → effectiveDeadline anchors to the
  // window close (12:00 - 5min buffer = 11:55), 115 minutes away.
  const conditions: IScheduleCondition[] = [
    {
      condition: "inSeasonalGridChargeWindow",
      value: [{ seasonName: "summer", from: "00:00", to: "12:00" }],
    },
  ];
  const now = moment.tz("2026-07-13 10:00", TZ);
  const LAT = 33.4484;
  const LON = -112.074;

  beforeEach(() => {
    process.env.DRY_RUN = "false";
  });

  afterEach(() => {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    vi.restoreAllMocks();
  });

  it("never fetches a radiation ratio when the site has no location configured", async () => {
    const fleet = Fleet.getInstance(
      `smart-charging-radiation-no-location-test-${Date.now()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(SITE_INFO as any);
    vi.spyOn(fleet, "getLiveStatus").mockResolvedValue(
      LIVE_STATUS_WITH_SOLAR as any,
    );
    vi.spyOn(fleet, "getSolarHistory").mockResolvedValue([]);
    vi.spyOn(fleet as any, "getCalibration").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getChargeCurve").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getSiteLocation").mockResolvedValue(null);
    const getRadiationRatioSpy = vi.spyOn(fleet as any, "getRadiationRatio");
    vi.spyOn(fleet, "setGridCharging").mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(now.toDate());

    const result = await fleet.setSmartGridCharging(
      PRODUCT,
      JSON.stringify({ targetSoc: 90 }),
      conditions,
    );

    vi.useRealTimers();

    expect(getRadiationRatioSpy).not.toHaveBeenCalled();
    expect(result?.radiationRatio).toBeNull();
    expect(result?.situation).toBe("waiting");
    // linear-fallback solar (5kW available * 115min/60 * 0.5 efficiency =
    // 4.791667kWh) covers 35.5% of the 13.5kWh pack unadjusted; grid covers
    // the remaining 4.5% to reach the 90% target by peak.
    expect(result?.solarContributionPct).toBe(35.5);
    expect(result?.gridContributionPct).toBe(4.5);
    expect(result?.predictedSocAtPeak).toBe(90);
  });

  it("pulls the solar estimate down and shifts more of the target onto grid charging when the forecast is poor", async () => {
    const fleet = Fleet.getInstance(
      `smart-charging-radiation-poor-forecast-test-${Date.now()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(SITE_INFO as any);
    vi.spyOn(fleet, "getLiveStatus").mockResolvedValue(
      LIVE_STATUS_WITH_SOLAR as any,
    );
    vi.spyOn(fleet, "getSolarHistory").mockResolvedValue([]);
    vi.spyOn(fleet as any, "getCalibration").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getChargeCurve").mockResolvedValue(null);
    vi.spyOn(fleet as any, "getSiteLocation").mockResolvedValue({
      lat: LAT,
      lon: LON,
    });
    const getRadiationRatioSpy = vi
      .spyOn(fleet as any, "getRadiationRatio")
      .mockResolvedValue(0.5);
    vi.spyOn(fleet, "setGridCharging").mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(now.toDate());

    const result = await fleet.setSmartGridCharging(
      PRODUCT,
      JSON.stringify({ targetSoc: 90 }),
      conditions,
    );

    vi.useRealTimers();

    expect(getRadiationRatioSpy).toHaveBeenCalledWith(
      "42",
      LAT,
      LON,
      TZ,
      expect.anything(),
      expect.anything(),
    );
    const [, , , , calledNow, calledDeadline] =
      getRadiationRatioSpy.mock.calls[0];
    expect((calledNow as moment.Moment).toISOString()).toBe(now.toISOString());
    expect((calledDeadline as moment.Moment).toISOString()).toBe(
      moment.tz("2026-07-13 11:55", TZ).toISOString(),
    );

    expect(result?.radiationRatio).toBe(0.5);
    expect(result?.situation).toBe("waiting");
    // Same 4.791667kWh linear-fallback solar estimate, halved by the poor
    // radiation ratio → 2.395833kWh, covering only 17.7% of the pack; grid
    // makes up the difference (22.3%) to still hit the 90% target by peak.
    expect(result?.solarContributionPct).toBe(17.7);
    expect(result?.gridContributionPct).toBe(22.3);
    expect(result?.predictedSocAtPeak).toBe(90);
  });
});
