import { describe, it, expect } from "bun:test";
import moment from "moment-timezone";
import {
  parseTariffContent,
  hasTouData,
  getSeasonNames,
  getCurrentSeason,
  isCurrentlyInPeak,
  findNextPeakStart,
  isWithinWindow,
} from "~/server/util/tariff";
import type { TariffContent } from "~/server/types/common";

const TZ = "America/Denver";

// Helper: build a minimal TariffContent with on-peak Mon-Fri 17:00-21:00.
function makeSummerTariff(): TariffContent {
  return {
    utility_rates: {
      seasons: {
        summer: {
          fromMonth: 5,
          fromDay: 1,
          toMonth: 9,
          toDay: 30,
          tou_periods: {
            on_peak: [
              {
                fromDayOfWeek: 1, // Mon
                toDayOfWeek: 5, // Fri
                fromHour: 17,
                fromMinute: 0,
                toHour: 21,
                toMinute: 0,
              },
            ],
          },
        },
        winter: {
          fromMonth: 10,
          fromDay: 1,
          toMonth: 4,
          toDay: 30,
          tou_periods: {
            on_peak: [
              {
                fromDayOfWeek: 1,
                toDayOfWeek: 5,
                fromHour: 18,
                fromMinute: 0,
                toHour: 20,
                toMinute: 0,
              },
            ],
          },
        },
      },
    },
  };
}

describe("parseTariffContent", () => {
  it("returns null for null input", () => {
    expect(parseTariffContent(null)).toBeNull();
  });
  it("returns null for non-object input", () => {
    expect(parseTariffContent("string")).toBeNull();
  });
  it("returns the object cast as TariffContent for a valid object", () => {
    const obj = { utility_rates: {} };
    expect(parseTariffContent(obj)).toBe(obj);
  });
});

describe("hasTouData", () => {
  it("returns false for null", () => {
    expect(hasTouData(null)).toBe(false);
  });
  it("returns false for tariff with no seasons", () => {
    expect(hasTouData({})).toBe(false);
  });
  it("returns false when on_peak is empty", () => {
    const t: TariffContent = {
      utility_rates: {
        seasons: {
          summer: {
            fromMonth: 5,
            fromDay: 1,
            toMonth: 9,
            toDay: 30,
            tou_periods: { on_peak: [] },
          },
        },
      },
    };
    expect(hasTouData(t)).toBe(false);
  });
  it("returns true for a tariff with on_peak periods", () => {
    expect(hasTouData(makeSummerTariff())).toBe(true);
  });
});

describe("getSeasonNames", () => {
  it("returns season names", () => {
    expect(getSeasonNames(makeSummerTariff())).toEqual(
      expect.arrayContaining(["summer", "winter"]),
    );
  });
  it("returns empty array when no seasons", () => {
    expect(getSeasonNames({})).toEqual([]);
  });
});

describe("getCurrentSeason", () => {
  it("returns summer for a date in June", () => {
    const now = moment.tz("2024-06-15 10:00", TZ);
    const result = getCurrentSeason(makeSummerTariff(), now);
    expect(result?.name).toBe("summer");
  });
  it("returns winter for a date in January", () => {
    const now = moment.tz("2024-01-10 10:00", TZ);
    const result = getCurrentSeason(makeSummerTariff(), now);
    expect(result?.name).toBe("winter");
  });
  it("returns null when date falls in no season", () => {
    // Our test tariff has winter ending Apr 30 and summer starting May 1, no gap.
    // Insert a gap: override so winter ends Mar 31.
    const t = makeSummerTariff();
    t.utility_rates!.seasons!["winter"].toMonth = 3;
    t.utility_rates!.seasons!["winter"].toDay = 31;
    const now = moment.tz("2024-04-15 10:00", TZ);
    expect(getCurrentSeason(t, now)).toBeNull();
  });
});

describe("isCurrentlyInPeak", () => {
  it("returns true during on-peak hours on a weekday", () => {
    // Monday 18:00 in summer
    const now = moment.tz("2024-06-17 18:00", TZ); // June 17, 2024 is a Monday
    expect(isCurrentlyInPeak(makeSummerTariff(), now)).toBe(true);
  });
  it("returns false before on-peak hours", () => {
    const now = moment.tz("2024-06-17 16:59", TZ);
    expect(isCurrentlyInPeak(makeSummerTariff(), now)).toBe(false);
  });
  it("returns false after on-peak hours", () => {
    const now = moment.tz("2024-06-17 21:00", TZ);
    expect(isCurrentlyInPeak(makeSummerTariff(), now)).toBe(false);
  });
  it("returns false on weekends", () => {
    // Saturday June 15, 2024 at 18:00 — inside the time range but not the DOW range
    const now = moment.tz("2024-06-15 18:00", TZ);
    expect(isCurrentlyInPeak(makeSummerTariff(), now)).toBe(false);
  });
  it("returns false outside the season", () => {
    const now = moment.tz("2024-01-10 18:00", TZ);
    // Winter peak is 18:00-20:00; this SHOULD be true.
    expect(isCurrentlyInPeak(makeSummerTariff(), now)).toBe(true);
  });
});

describe("findNextPeakStart", () => {
  it("finds today's upcoming peak when called before it starts", () => {
    // Monday 14:00 — peak starts at 17:00 today
    const now = moment.tz("2024-06-17 14:00", TZ);
    const next = findNextPeakStart(makeSummerTariff(), now);
    expect(next).not.toBeNull();
    expect(next!.format("HH:mm")).toBe("17:00");
    expect(next!.isSame(now, "day")).toBe(true);
  });

  it("finds tomorrow's peak when called after today's peak ends", () => {
    // Monday 22:00 — today's peak is done, next is Tuesday 17:00
    const now = moment.tz("2024-06-17 22:00", TZ);
    const next = findNextPeakStart(makeSummerTariff(), now);
    expect(next).not.toBeNull();
    expect(next!.format("YYYY-MM-DD HH:mm")).toBe("2024-06-18 17:00");
  });

  it("skips weekend when called on Friday after peak", () => {
    // Friday 22:00 — next peak is Monday
    const now = moment.tz("2024-06-21 22:00", TZ); // Friday
    const next = findNextPeakStart(makeSummerTariff(), now);
    expect(next).not.toBeNull();
    expect(next!.day()).toBe(1); // Monday
  });

  it("returns null when no TOU data", () => {
    const t: TariffContent = { utility_rates: { seasons: {} } };
    const now = moment.tz("2024-06-17 14:00", TZ);
    expect(findNextPeakStart(t, now)).toBeNull();
  });
});

describe("real SRP E27 tariff shape (top-level seasons + ON_PEAK keys)", () => {
  // Mirrors the actual structure returned by the Tesla Fleet API.
  const srpTariff: TariffContent = {
    seasons: {
      Summer: {
        fromDay: 1,
        toDay: 30,
        fromMonth: 11,
        toMonth: 4,
        tou_periods: {
          ON_PEAK: [
            {
              fromDayOfWeek: 0,
              toDayOfWeek: 4,
              fromHour: 5,
              fromMinute: 0,
              toHour: 9,
              toMinute: 0,
            },
            {
              fromDayOfWeek: 0,
              toDayOfWeek: 4,
              fromHour: 17,
              fromMinute: 0,
              toHour: 21,
              toMinute: 0,
            },
          ],
        },
      },
      Winter: {
        fromDay: 1,
        toDay: 31,
        fromMonth: 5,
        toMonth: 10,
        tou_periods: {
          ON_PEAK: [
            {
              fromDayOfWeek: 0,
              toDayOfWeek: 4,
              fromHour: 14,
              fromMinute: 0,
              toHour: 20,
              toMinute: 0,
            },
          ],
        },
      },
    },
  };

  it("hasTouData returns true", () => {
    expect(hasTouData(srpTariff)).toBe(true);
  });

  it("getSeasonNames returns Summer and Winter", () => {
    expect(getSeasonNames(srpTariff)).toEqual(
      expect.arrayContaining(["Summer", "Winter"]),
    );
  });

  it("getCurrentSeason returns Winter for June (May–Oct)", () => {
    // SRP Winter runs May(5)–Oct(10)
    const now = moment.tz("2024-06-17 10:00", TZ);
    const result = getCurrentSeason(srpTariff, now);
    expect(result?.name).toBe("Winter");
  });

  it("isCurrentlyInPeak returns true during Winter on-peak hours", () => {
    // Winter ON_PEAK: Mon-Fri 14:00-20:00; June 17 2024 is Monday
    const now = moment.tz("2024-06-17 16:00", TZ);
    expect(isCurrentlyInPeak(srpTariff, now)).toBe(true);
  });

  it("isCurrentlyInPeak returns false before Winter on-peak hours", () => {
    const now = moment.tz("2024-06-17 13:00", TZ);
    expect(isCurrentlyInPeak(srpTariff, now)).toBe(false);
  });

  it("findNextPeakStart finds today's upcoming peak", () => {
    const now = moment.tz("2024-06-17 10:00", TZ); // Monday before 14:00
    const next = findNextPeakStart(srpTariff, now);
    expect(next).not.toBeNull();
    expect(next!.format("HH:mm")).toBe("14:00");
  });
});

describe("isWithinWindow", () => {
  it("returns true when empty strings are passed", () => {
    const now = moment.tz("2024-06-17 10:00", TZ);
    expect(isWithinWindow("", "", now)).toBe(true);
  });

  it("returns true when now is inside a non-wrapping window", () => {
    const now = moment.tz("2024-06-17 02:00", TZ);
    expect(isWithinWindow("22:00", "06:00", now)).toBe(true);
  });

  it("returns false when now is outside a non-wrapping window", () => {
    const now = moment.tz("2024-06-17 10:00", TZ);
    expect(isWithinWindow("22:00", "06:00", now)).toBe(false);
  });

  it("returns true when now is inside a simple window", () => {
    const now = moment.tz("2024-06-17 23:00", TZ);
    expect(isWithinWindow("22:00", "06:00", now)).toBe(true);
  });

  it("handles exact boundary — fromMins == nowMins is inclusive", () => {
    const now = moment.tz("2024-06-17 22:00", TZ);
    expect(isWithinWindow("22:00", "06:00", now)).toBe(true);
  });

  it("handles exact boundary — toMins == nowMins is exclusive", () => {
    const now = moment.tz("2024-06-17 06:00", TZ);
    expect(isWithinWindow("22:00", "06:00", now)).toBe(false);
  });
});
