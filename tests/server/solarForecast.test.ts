import { describe, it, expect } from "bun:test";
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
      points.push({ timestamp: ts, solar_power: map.get(h) ?? 0 });
    }
  }
  return points;
}

// 7 identical days with solarWatts from 08:00 to 16:59 (full-hour resolution).
function makeSeven(solarWatts: number): SolarPowerDataPoint[] {
  const days: SolarPowerDataPoint[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2026-06-${String(d).padStart(2, "0")}`;
    days.push(
      ...makeDay(
        date,
        Array.from(
          { length: 9 },
          (_, i) => [8 + i, solarWatts] as [number, number],
        ),
      ),
    );
  }
  return days;
}

const sunnySeven = () => makeSeven(1000);

describe("estimateSolarKwhFromHistory", () => {
  describe("basic integration", () => {
    it("returns null for empty data points", () => {
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      expect(estimateSolarKwhFromHistory([], now, peak, 1.0, TZ)).toBeNull();
    });

    it("returns null when fewer than 3 valid days", () => {
      const data = sunnySeven().filter(
        (p) =>
          p.timestamp.startsWith("2026-06-01") ||
          p.timestamp.startsWith("2026-06-02"),
      );
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      expect(estimateSolarKwhFromHistory(data, now, peak, 1.0, TZ)).toBeNull();
    });

    it("correctly integrates 4 hours of 1kW solar across 7 identical days (no scaling)", () => {
      // Window 10:00–14:00 (240 min = 4 h). Each 5-min slot = 1kW × (5/60) h.
      // 48 slots × (1/12) = 4 kWh per day. currentSolarKw < 0.3 so no scaling.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        sunnySeven(),
        now,
        peak,
        0.0, // pre-sunrise — no scaling
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.estimatedKwh).toBeCloseTo(4, 1);
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.daysUsed).toBe(7);
    });
  });

  describe("weather scaling", () => {
    it("applies scaling when current solar >= 0.3 kW and historical average >= 0.3 kW", () => {
      // Historical average at 10:00 = 1 kW. Today = 0.5 kW → factor = 0.5.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        sunnySeven(),
        now,
        peak,
        0.5, // today is 50% of historical average
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
        sunnySeven(),
        now,
        peak,
        5.0, // 5× historical
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(2.0);
    });

    it("clamps scaling factor at 0.1 when today is very low vs high historical average", () => {
      // Historical average at 10:00 = 10 kW. Today = 0.5 kW → raw ratio = 0.05 → clamped to 0.1.
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        makeSeven(10_000), // 10 kW historical
        now,
        peak,
        0.5, // 0.5 / 10 = 0.05, below SCALING_MIN
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(0.1);
    });

    it("skips scaling when current solar is below 0.3 kW (pre-sunrise)", () => {
      const now = moment.tz("2026-06-08 10:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(
        sunnySeven(),
        now,
        peak,
        0.1, // below threshold
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.scalingFactor).toBe(1.0);
      expect(result!.estimatedKwh).toBeCloseTo(4, 1);
    });

    it("skips scaling when historical average at current time is below 0.3 kW", () => {
      // All 7 days have 0 solar at 06:00 (before sunrise in our test data).
      const data = sunnySeven();
      const now = moment.tz("2026-06-08 06:00", TZ);
      const peak = moment.tz("2026-06-08 14:00", TZ);
      const result = estimateSolarKwhFromHistory(data, now, peak, 1.0, TZ);
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
      expect(estimateSolarKwhFromHistory(data, now, peak, 0, TZ)).toBeNull();
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
        0.0,
        TZ,
      );
      expect(result).not.toBeNull();
      expect(result!.daysUsed).toBe(5);
    });
  });
});
