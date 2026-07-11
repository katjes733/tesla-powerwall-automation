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
