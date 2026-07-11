import { describe, it, expect } from "vitest";
import moment from "moment-timezone";
import { estimateSolarKwhFromHistory } from "~/server/util/solarForecast";
import type { SolarPowerDataPoint } from "~/server/types/common";

const TZ = "America/Denver";

// Build a set of 5-min data points for a given date. solarByHour is an array
// of [hourOfDay, solarWatts] pairs; everything else is 0.
function makeDay(
  date: string,
  solarByHour: Array<[number, number]>,
): SolarPowerDataPoint[] {
  const map = new Map(solarByHour);
  const points: SolarPowerDataPoint[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const ts = moment
        .tz(
          `${date} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          TZ,
        )
        .toISOString();
      points.push({
        timestamp: ts,
        solar_power: map.get(h) ?? 0,
        battery_power: 0,
        grid_power: 0,
        load_power: 0,
      });
    }
  }
  return points;
}

// Solar hours template: hours 8–16 inclusive at the given wattage.
function solarHours(watts: number): Array<[number, number]> {
  return Array.from(
    { length: 9 },
    (_, i) => [8 + i, watts] as [number, number],
  );
}

// 7 identical historical days (June 1–7) at solarWatts from 08:00 to 16:59.
function makeSeven(solarWatts: number): SolarPowerDataPoint[] {
  const days: SolarPowerDataPoint[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2026-06-${String(d).padStart(2, "0")}`;
    days.push(...makeDay(date, solarHours(solarWatts)));
  }
  return days;
}

// Today's data (June 8) at the given wattage — combined with makeSeven() for a
// full dataset including today.
function makeToday(solarWatts: number): SolarPowerDataPoint[] {
  return makeDay("2026-06-08", solarHours(solarWatts));
}

const sunnySeven = () => makeSeven(1000);

describe("estimateSolarKwhFromHistory", () => {
  describe("basic integration", () => {
    it("returns null for empty data points", () => {
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      expect(estimateSolarKwhFromHistory([], now, peak, TZ)).toBeNull();
    });

    it("returns null when fewer than 3 valid days", () => {
      const data = sunnySeven().filter(
        (p) =>
          p.timestamp.startsWith("2026-06-01") ||
          p.timestamp.startsWith("2026-06-02"),
      );
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      expect(estimateSolarKwhFromHistory(data, now, peak, TZ)).toBeNull();
    });

    it("correctly integrates 4 hours of 1kW solar across 7 days when today matches history", () => {
      // Window 10:00–14:00 = 4h. Each 5-min slot = 1kW × (5/60)h.
      // 48 slots × (1/12) = 4 kWh. Today matches history → scalingFactor = 1.0.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...sunnySeven(), ...makeToday(1000)],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.estimatedKwh).toBeCloseTo(4, 1);
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.daysUsed).toBe(7);
    });
  });

  describe("weather scaling", () => {
    it("applies scaling when today's cumulative is 50% of historical", () => {
      // Historical: 1kW 8:00–16:59. Today: 500W.
      // By 10:00: todayToNow = 1 kWh, histToNow = 2 kWh → factor = 0.5.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...sunnySeven(), ...makeToday(500)],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBeCloseTo(0.5, 5);
      expect(result!.estimatedKwh).toBeCloseTo(4 * 0.5, 1);
    });

    it("clamps scaling factor at 2.0 when today exceeds 2× history", () => {
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...sunnySeven(), ...makeToday(5000)],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(2.0);
    });

    it("clamps scaling factor at 0.1 when today is very low vs high historical average", () => {
      // Historical 10kW → histToNow = 20 kWh. Today 600W → todayToNow = 1.2 kWh.
      // ratio = 1.2/20 = 0.06 < SCALING_MIN(0.1) → clamped to 0.1.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...makeSeven(10_000), ...makeToday(600)],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(0.1);
    });

    it("skips scaling when today has no data yet (returns unscaled historical average)", () => {
      // No June 8 data → todayEnergyToNow = 0 < MIN_CUMULATIVE_FOR_SCALING_KWH → factor = 1.0.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(sunnySeven(), now, peak, TZ);
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.estimatedKwh).toBeCloseTo(4, 1);
    });

    it("skips scaling before solar hours when cumulative is below threshold", () => {
      // Solar starts at 08:00. now = 06:00 → both today and history have 0 kWh before 06:00.
      const now = moment.tz("2026-06-08 06:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...sunnySeven(), ...makeToday(1000)],
        now,
        peak,
        TZ,
      );
      // Historical energy 06:00–14:00 includes hours 8–13 = 6 h × 1 kW = 6 kWh.
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(1.0);
    });
  });

  describe("edge cases", () => {
    it("returns null when window falls entirely outside solar hours (all zero)", () => {
      // Window 22:00–23:00 — no solar in history. Days are rejected, <3 valid.
      const data = sunnySeven();
      const now = moment.tz("2026-06-08 22:00", TZ);
      const peak = moment.tz("2026-06-08 23:00", TZ);
      expect(estimateSolarKwhFromHistory(data, now, peak, TZ)).toBeNull();
    });

    it("returns null when now is at or after peakStart on the same day, instead of wrapping to a near-full-day window", () => {
      // Regression: peakStart 1 minute in the past used to be misread as an
      // overnight wrap (now > peakStart time-of-day), summing nearly the
      // entire day's historical solar instead of recognizing the window has
      // already elapsed.
      const now = moment.tz("2026-06-08 13:41", TZ);
      const peak = moment.tz("2026-06-08 13:40", TZ);
      expect(
        estimateSolarKwhFromHistory(
          [...sunnySeven(), ...makeToday(1000)],
          now,
          peak,
          TZ,
        ),
      ).toBeNull();
    });

    it("returns null when now equals peakStart exactly", () => {
      const now = moment.tz("2026-06-08 13:40", TZ);
      const peak = moment.tz("2026-06-08 13:40", TZ);
      expect(
        estimateSolarKwhFromHistory(
          [...sunnySeven(), ...makeToday(1000)],
          now,
          peak,
          TZ,
        ),
      ).toBeNull();
    });

    it("still computes a genuine overnight wrap when peakStart is tomorrow", () => {
      // now = 23:00 today, peak = 09:00 tomorrow — a real cross-midnight
      // window (overlapping the 08:00 solar hour), not an elapsed one; must
      // not be short-circuited to null just because peakStart's time-of-day
      // (09:00) is numerically before now's (23:00).
      const now = moment.tz("2026-06-07 23:00", TZ);
      const peak = moment.tz("2026-06-08 09:00", TZ);
      const result = estimateSolarKwhFromHistory(sunnySeven(), now, peak, TZ);
      expect(result).not.toBeNull();
      expect(result!.daysUsed).toBe(6);
    });

    it("uses only days that have readings in the window", () => {
      // 5 days with readings 10:00–14:00, plus 2 days with no readings in that window.
      const goodDays = sunnySeven().filter((p) => {
        const d = Number(p.timestamp.substring(8, 10));
        return d <= 5;
      });
      const badDays: SolarPowerDataPoint[] = [];
      for (let d = 6; d <= 7; d++) {
        const date = `2026-06-${String(d).padStart(2, "0")}`;
        // Only night-time solar (no readings in window 10:00–14:00)
        badDays.push(...makeDay(date, [[0, 10]]));
      }
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...goodDays, ...badDays],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.daysUsed).toBe(5);
    });
  });

  describe("multi-day gaps", () => {
    // History: June 1–7 (Mon–Sun), 1kW solar 08:00–16:59 (9 kWh/full day).

    it("sums full intervening days when peakStart is 2 calendar days away (Friday evening → Monday afternoon)", () => {
      // Real bug scenario: Saturday/Sunday have no on-peak period, so the
      // next on-peak is Monday — 2 full calendar days (Sat, Sun) sit between
      // now's day and peakStart's day. No "today" (June 12) data, isolating
      // the day-count math from weather scaling.
      const now = moment.tz("2026-06-12 20:00", TZ); // Friday
      const peak = moment.tz("2026-06-15 14:00", TZ); // Monday
      const result = estimateSolarKwhFromHistory(sunnySeven(), now, peak, TZ);
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.daysUsed).toBe(7);
      // Tail/head window (todMins>=1200 || todMins<840) captures hours 8–13
      // = 6 kWh/day. Plus 2 extra full days at 9 kWh each = 6 + 18 = 24.
      expect(result!.estimatedKwh).toBeCloseTo(24, 1);
    });

    it("uses the wrap-style window (not a near-empty same-day slice) when dayGap=1 even though nowMins <= peakMins", () => {
      // now's time-of-day (08:00) is numerically before peakStart's (10:00),
      // but peakStart is on the NEXT calendar day — a 1-day gap. Selecting
      // the window filter by nowMins<=peakMins instead of by dayGap would
      // wrongly take a same-day 08:00–10:00 slice (~2 kWh), missing nearly
      // the whole solar day.
      const now = moment.tz("2026-06-08 08:00", TZ); // Monday
      const peak = moment.tz("2026-06-09 10:00", TZ); // Tuesday
      const result = estimateSolarKwhFromHistory(sunnySeven(), now, peak, TZ);
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.daysUsed).toBe(7);
      expect(result!.estimatedKwh).toBeCloseTo(9, 1);
    });

    it("applies weather scaling to the whole extended total, not just the window-slice component", () => {
      // Same Friday→Monday gap as above, but today (June 12) ran at half
      // historical output through 20:00 → scalingFactor = 0.5, applied to
      // the full (window + extra days) sum, not just the 6 kWh window piece.
      const now = moment.tz("2026-06-12 20:00", TZ);
      const peak = moment.tz("2026-06-15 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        [...sunnySeven(), ...makeDay("2026-06-12", solarHours(500))],
        now,
        peak,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBeCloseTo(0.5, 5);
      // (6 + 2*9) * 0.5 = 12
      expect(result!.estimatedKwh).toBeCloseTo(12, 1);
    });

    it("scales extraFullDays correctly for a different gap magnitude (not hardcoded to the 2-day case)", () => {
      // Friday evening → Sunday afternoon: only Saturday is fully intervening.
      const now = moment.tz("2026-06-12 20:00", TZ); // Friday
      const peak = moment.tz("2026-06-14 14:00", TZ); // Sunday
      const result = estimateSolarKwhFromHistory(sunnySeven(), now, peak, TZ);
      expect(result).not.toBeNull();
      expect(result!.daysUsed).toBe(7);
      // 6 kWh window + 1 extra full day at 9 kWh = 15.
      expect(result!.estimatedKwh).toBeCloseTo(15, 1);
    });

    it("still returns null under MIN_VALID_DAYS with a multi-day gap", () => {
      const data = sunnySeven().filter(
        (p) =>
          p.timestamp.startsWith("2026-06-01") ||
          p.timestamp.startsWith("2026-06-02"),
      );
      const now = moment.tz("2026-06-12 20:00", TZ);
      const peak = moment.tz("2026-06-15 14:00", TZ);
      expect(estimateSolarKwhFromHistory(data, now, peak, TZ)).toBeNull();
    });
  });
});
