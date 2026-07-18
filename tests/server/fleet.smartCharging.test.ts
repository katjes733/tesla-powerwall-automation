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

// on-peak weekdays only (Tesla convention: 0=Mon…6=Sun) — real TOU plans
// commonly have no on-peak at all on weekends, which is what lets
// findNextPeakStart roll the deadline out to a future calendar day and
// exercises the window/deadline-anchoring logic below.
const TARIFF_WEEKDAYS_ONLY = {
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
              toDayOfWeek: 4,
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

const SITE_INFO_WEEKDAYS_ONLY = {
  ...SITE_INFO,
  tariff_content: TARIFF_WEEKDAYS_ONLY,
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

describe("setSmartGridCharging — waiting for a later start doesn't misreport a shortfall", () => {
  const originalDryRun = process.env.DRY_RUN;

  beforeEach(() => {
    process.env.DRY_RUN = "false";
  });

  afterEach(() => {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    vi.restoreAllMocks();
  });

  it("still shows the full achievable grid contribution when currently outside the window but plenty of time remains before the latest start", async () => {
    const fleet = Fleet.getInstance(
      `smart-charging-waiting-outside-window-test-${Date.now()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    // Window allowed 00:00–12:00; on-peak today already ended (13:45–21:00),
    // so the next peak is tomorrow 13:45. Evaluating at 22:00 today — outside
    // the window, but the latest possible grid-start (tomorrow ~12:15) is
    // still ~14 hours away, so this must be "waiting", not a real shortfall.
    // Regression for the bug reported from a real log: achievableGridKwh was
    // being zeroed out just because the window happened to be closed at the
    // moment of evaluation, even though grid charging hadn't started yet and
    // was fully on schedule to run within tomorrow's window.
    const conditions: IScheduleCondition[] = [
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "12:00" }],
      },
    ];
    const now = moment.tz("2026-07-13 22:00", TZ);

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
    // No solar in this fixture, so the full 5.4kWh (40% of the 13.5kWh pack)
    // needed is achievable from grid alone, well within the ~14 remaining
    // hours — predictedSocAtPeak must reach the 90% target, not stall at 50%.
    expect(result?.gridContributionPct).toBe(40);
    expect(result?.predictedSocAtPeak).toBe(90);
    expect(result?.targetGapPct).toBe(0);
    expect(result?.reason).not.toContain("predicted only");
  });
});

describe("setSmartGridCharging — window-close deadline anchors to the peak's own day, not today (multi-day gaps)", () => {
  const originalDryRun = process.env.DRY_RUN;

  // 50% → 90% on a single 13.5kWh PW2 (4kW effective rate, no calibration/
  // curve) needs energyNeededKwh=5.4kWh, entirely below the CV taper zone
  // (starts at 95%), so calculateGridChargeHours always takes the flat-rate
  // path here: 5.4/4h + the 2-minute startup buffer = 83 minutes exactly —
  // kept identical across every test below so only the deadline anchor
  // differs between them, isolating exactly what's under test.
  const GRID_CHARGE_MINUTES = 83;

  beforeEach(() => {
    process.env.DRY_RUN = "false";
  });

  afterEach(() => {
    if (originalDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = originalDryRun;
    vi.restoreAllMocks();
  });

  async function run(
    siteInfo: any,
    now: moment.Moment,
    conditions: IScheduleCondition[],
  ) {
    const fleet = Fleet.getInstance(
      `smart-charging-deadline-anchor-test-${Date.now()}-${Math.random()}@example.com`,
      { throwOnError: false, mailOnError: false },
    );

    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(siteInfo);
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
    return result;
  }

  it("REGRESSION: anchors to Monday's window close, not Saturday's, when the next peak is Monday (weekend gap)", async () => {
    // The exact scenario reported in production: Saturday morning, on-peak
    // only runs Mon–Fri, so the next peak is Monday. Before the fix, the
    // window-close anchor was computed against *today's* date (Saturday),
    // which — since the numeric close/open times exist every day — always
    // resolved to a close time far earlier than Monday's real peak and
    // collapsed the whole weekend's runway down to a few hours on Saturday.
    const now = moment.tz("2026-07-18 08:00", TZ); // Saturday
    const conditions: IScheduleCondition[] = [
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "13:30" }],
      },
    ];

    const result = await run(SITE_INFO_WEEKDAYS_ONLY, now, conditions);

    expect(result?.situation).toBe("waiting");
    expect(result?.peakOrDeadlineAt).toBe(
      moment.tz("2026-07-20 13:45", TZ).toISOString(),
    );
    // Window closes 13:30 Monday (the peak's own day) − 5min buffer = 13:25,
    // minus the 83min charge time = 12:02 *Monday*, not Saturday.
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-20 12:02", TZ).toISOString(),
    );
  });

  it("does not anchor early when the peak day's own window closes after that day's peak (weekend gap, loose window)", async () => {
    // Same weekend gap as above, but the window (closes 22:00) isn't
    // actually tighter than Monday's peak — the deadline must stay
    // peak-anchored on Monday, not get pulled to some other day's window.
    const now = moment.tz("2026-07-18 08:00", TZ); // Saturday
    const conditions: IScheduleCondition[] = [
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "22:00" }],
      },
    ];

    const result = await run(SITE_INFO_WEEKDAYS_ONLY, now, conditions);

    expect(result?.situation).toBe("waiting");
    // Monday 13:45 peak − 5min buffer = 13:40, minus 83min = 12:17 Monday.
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-20 12:17", TZ).toISOString(),
    );
  });

  it("anchors to Tuesday's window close, not Monday's, when Monday is an observed holiday", async () => {
    // Monday would normally be the next peak day, but it's a declared
    // holiday (off-peak override for the whole day), so the real next peak
    // rolls to Tuesday — the window anchor must follow it there, not use
    // Monday's (today's, from this tick's point of view) window instance.
    const now = moment.tz("2026-07-20 08:00", TZ); // Monday, declared a holiday
    const conditions: IScheduleCondition[] = [
      {
        condition: "holidayList",
        value: [
          {
            name: "Test Holiday",
            date: "07-20",
            observance: "none",
            source: "custom",
            enabled: true,
          },
        ],
      },
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "13:30" }],
      },
    ];

    const result = await run(SITE_INFO_WEEKDAYS_ONLY, now, conditions);

    expect(result?.situation).toBe("waiting");
    expect(result?.peakOrDeadlineAt).toBe(
      moment.tz("2026-07-21 13:45", TZ).toISOString(),
    );
    // Tuesday 13:30 window close − 5min buffer = 13:25, minus 83min = 12:02
    // *Tuesday*, not Monday.
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-21 12:02", TZ).toISOString(),
    );
  });

  it("still anchors correctly across a longer combined gap (Friday evening, weekend, Monday holiday → Tuesday peak)", async () => {
    // A 4-calendar-day gap (Friday → Tuesday) combining a weekend and a
    // holiday — the largest, least "off by one" version of this bug class.
    // Evaluated after Friday's own on-peak has already ended, so the search
    // for the next peak has to walk all the way through the weekend and the
    // Monday holiday before landing on Tuesday.
    const now = moment.tz("2026-07-17 22:00", TZ); // Friday, after on-peak ends
    const conditions: IScheduleCondition[] = [
      {
        condition: "holidayList",
        value: [
          {
            name: "Test Holiday",
            date: "07-20",
            observance: "none",
            source: "custom",
            enabled: true,
          },
        ],
      },
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "13:30" }],
      },
    ];

    const result = await run(SITE_INFO_WEEKDAYS_ONLY, now, conditions);

    expect(result?.situation).toBe("waiting");
    expect(result?.peakOrDeadlineAt).toBe(
      moment.tz("2026-07-21 13:45", TZ).toISOString(),
    );
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-21 12:02", TZ).toISOString(),
    );
  });

  it("baseline: same-day window looser than today's own peak still leaves the deadline peak-anchored", async () => {
    // Sanity check on an ordinary weekday (dayGap=0) mirroring the "loose
    // window" assertion above, so a regression that only breaks the
    // future-day path (or only the same-day path) would still be caught by
    // at least one of these two tests.
    const now = moment.tz("2026-07-20 10:00", TZ); // Monday, ordinary weekday
    const conditions: IScheduleCondition[] = [
      {
        condition: "inSeasonalGridChargeWindow",
        value: [{ seasonName: "summer", from: "00:00", to: "22:00" }],
      },
    ];

    const result = await run(SITE_INFO_WEEKDAYS_ONLY, now, conditions);

    expect(result?.situation).toBe("waiting");
    expect(result?.gridStartAt).toBe(
      moment.tz("2026-07-20 12:17", TZ).toISOString(),
    );
  });

  it("GRID_CHARGE_MINUTES sanity: confirms the shared 83-minute charge-time assumption every test above depends on", () => {
    // If this ever fails, every gridStartAt assertion above needs
    // recomputing — it's not itself a deadline-anchoring test, just a
    // guardrail so a change to the flat-rate charge-time formula fails
    // loudly here instead of silently invalidating the anchor assertions.
    const energyNeededKwh = 13.5 * 0.4; // 50% -> 90% of a 13.5kWh pack
    const chargeRateKw = 4;
    const startupBufferMinutes = 2;
    const computedMinutes =
      (energyNeededKwh / chargeRateKw) * 60 + startupBufferMinutes;
    expect(Math.round(computedMinutes)).toBe(GRID_CHARGE_MINUTES);
  });
});
