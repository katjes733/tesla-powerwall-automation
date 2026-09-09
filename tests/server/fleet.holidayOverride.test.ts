import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import moment from "moment-timezone";

// ---------------------------------------------------------------------------
// Module mocks — recordHolidayStatus (the new persistence side-channel added
// alongside setTouHolidayOverride) is the one bit of this test that actually
// needs to reach the mocked DB, so — unlike fleet.smartCharging.test.ts's
// deliberately-hanging datasource stub — this one must resolve to a
// repository whose findOne/save calls are assertable.
// ---------------------------------------------------------------------------

const { mockFindOne, mockSave } = vi.hoisted(() => ({
  mockFindOne: vi.fn(async () => null as unknown),
  mockSave: vi.fn(async (entity: unknown) => entity),
}));

vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(async () => ({
      getRepository: vi.fn(() => ({
        findOne: mockFindOne,
        save: mockSave,
      })),
    })),
  },
}));

import { Fleet } from "~/server/util/fleet";
import type { IScheduleCondition } from "~/server/database/models/schedule";
import type { Product } from "~/server/types/common";

const TZ = "America/Phoenix";
const PRODUCT: Product = {
  id: "prod-1",
  site_name: "Test Site",
  device_type: "energy",
  energy_site_id: 42,
  gateway_id: "gw-1",
};

// Fixed-date holiday on 09-01 (observance "none" so no weekend-shift
// ambiguity) — "today"/"yesterday" are controlled per-test via fake timers.
const CONDITIONS: IScheduleCondition[] = [
  {
    condition: "holidayList",
    value: [
      {
        name: "Test Holiday",
        date: "09-01",
        observance: "none",
        source: "custom",
        enabled: true,
      },
    ],
  },
];

const SITE_INFO_WITH_TARIFF = {
  installation_time_zone: TZ,
  tariff_content_v2: { seasons: {} },
};

const SITE_INFO_NO_TARIFF = {
  installation_time_zone: TZ,
  tariff_content_v2: undefined,
};

function uniqueEmail(label: string): string {
  return `holiday-override-${label}-${Date.now()}-${Math.random()}@example.com`;
}

describe("setTouHolidayOverride — persisted status", () => {
  beforeEach(() => {
    mockFindOne.mockResolvedValue(null);
    mockSave.mockImplementation(async (entity: unknown) => entity);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("records action 'override' when today is the holiday and the TOU override applies successfully", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("applied"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_WITH_TARIFF as any,
    );
    vi.spyOn(fleet as any, "applyHolidayTou").mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-01 08:00", TZ).toDate());

    const result = await fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS);

    expect(result).toEqual({ today: "2026-09-01", holidayAction: "override" });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: "42",
        date: "2026-09-01",
        action: "override",
        holiday_name: "Test Holiday",
        error: null,
      }),
    );
  });

  it("records action 'failed' with the error message — and still rejects — when applying the TOU override throws", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("apply-fails"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_WITH_TARIFF as any,
    );
    vi.spyOn(fleet as any, "applyHolidayTou").mockRejectedValue(
      new Error("Error posting TOU settings: 500 Internal Server Error"),
    );
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-01 08:00", TZ).toDate());

    await expect(
      fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS),
    ).rejects.toThrow("Error posting TOU settings: 500 Internal Server Error");

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: "42",
        date: "2026-09-01",
        action: "failed",
        holiday_name: "Test Holiday",
        error: "Error posting TOU settings: 500 Internal Server Error",
      }),
    );
  });

  it("records action 'failed' when no tariff_content_v2 is available, without throwing", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("no-tariff"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_NO_TARIFF as any,
    );
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-01 08:00", TZ).toDate());

    const result = await fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS);

    expect(result).toEqual({ today: "2026-09-01", holidayAction: "none" });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "failed",
        error: "No tariff_content_v2 available",
      }),
    );
  });

  it("records action 'restore' the day after the holiday", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("restore"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_WITH_TARIFF as any,
    );
    vi.spyOn(fleet as any, "restoreTou").mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-02 08:00", TZ).toDate());

    const result = await fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS);

    expect(result).toEqual({ today: "2026-09-02", holidayAction: "restore" });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: "42",
        date: "2026-09-02",
        action: "restore",
        holiday_name: null,
        error: null,
      }),
    );
  });

  it("records action 'none' on an ordinary (non-holiday, non-day-after) day", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("none"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_WITH_TARIFF as any,
    );
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-15 08:00", TZ).toDate());

    const result = await fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS);

    expect(result).toEqual({ today: "2026-09-15", holidayAction: "none" });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: "42",
        date: "2026-09-15",
        action: "none",
        holiday_name: null,
        error: null,
      }),
    );
  });

  it("updates the existing row in place (same id) rather than inserting a new one on a repeat evaluation", async () => {
    const fleet = Fleet.getInstance(uniqueEmail("upsert"), {
      throwOnError: false,
      mailOnError: false,
    });
    vi.spyOn(fleet, "getSiteInfo").mockResolvedValue(
      SITE_INFO_WITH_TARIFF as any,
    );
    mockFindOne.mockResolvedValue({
      id: "existing-row-id",
      site_id: "42",
      creation_time: new Date("2026-08-01T00:00:00.000Z"),
    });
    vi.useFakeTimers();
    vi.setSystemTime(moment.tz("2026-09-15 08:00", TZ).toDate());

    await fleet.setTouHolidayOverride(PRODUCT, "", CONDITIONS);

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "existing-row-id",
        creation_time: new Date("2026-08-01T00:00:00.000Z"),
      }),
    );
  });
});
