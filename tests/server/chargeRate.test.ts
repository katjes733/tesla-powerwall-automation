import { describe, it, expect } from "vitest";
import {
  calculateChargeRateKw,
  calculateGridChargeHours,
  calculateTotalCapacityKwh,
  GRID_CHARGE_STARTUP_BUFFER_MINUTES,
} from "~/server/util/chargeRate";
import type { ChargeCurveCalibrationData } from "~/server/util/curveFit";
import type { SiteComponents } from "~/server/types/common";

function makeCurve(
  bins: Array<{ soc_percent: number; battery_kw: number }>,
): ChargeCurveCalibrationData {
  return {
    bins: bins.map((b) => ({ ...b, sample_count: 100 })),
    total_sample_count: 100,
    soc_range_percent: 100,
    data_window_days: 30,
    built_at: "2024-01-01T00:00:00.000Z",
  };
}

const STARTUP_HOURS = GRID_CHARGE_STARTUP_BUFFER_MINUTES / 60;

const SAFETY = 0.8;

function makeComponents(
  gateways: Array<{ part_name?: string; is_active: boolean }>,
  batteries: Array<{ part_name?: string; is_active: boolean }>,
): SiteComponents {
  return {
    gateways: gateways.map((g, i) => ({ device_id: `gw-${i}`, ...g })),
    batteries: batteries.map((b, i) => ({ device_id: `bat-${i}`, ...b })),
  };
}

describe("calculateChargeRateKw", () => {
  describe("PW2 systems", () => {
    it("returns 0 for no batteries", () => {
      expect(calculateChargeRateKw(makeComponents([], []))).toBe(0);
    });

    it("1 PW2 = 5 * 0.8 = 4 kW", () => {
      const components = makeComponents(
        [],
        [{ part_name: "Powerwall 2", is_active: true }],
      );
      expect(calculateChargeRateKw(components)).toBe(5 * SAFETY);
    });

    it("3 PW2 = 15 * 0.8 = 12 kW", () => {
      const components = makeComponents(
        [],
        Array.from({ length: 3 }, () => ({
          part_name: "Powerwall 2",
          is_active: true,
        })),
      );
      expect(calculateChargeRateKw(components)).toBe(15 * SAFETY);
    });

    it("ignores inactive PW2 batteries", () => {
      const components = makeComponents(
        [],
        [
          { part_name: "Powerwall 2", is_active: true },
          { part_name: "Powerwall 2", is_active: false },
        ],
      );
      expect(calculateChargeRateKw(components)).toBe(5 * SAFETY);
    });
  });

  describe("PW3 systems — single master, no expansions", () => {
    it("1 PW3 master only = 5 * 0.8 = 4 kW", () => {
      const components = makeComponents(
        [{ part_name: "Powerwall 3", is_active: true }],
        [],
      );
      expect(calculateChargeRateKw(components)).toBe(5 * SAFETY);
    });
  });

  describe("PW3 systems — single master with expansions", () => {
    it("1 PW3 master + 1 expansion = 8 * 0.8 = 6.4 kW", () => {
      const components = makeComponents(
        [{ part_name: "Powerwall 3", is_active: true }],
        [{ part_name: "Unknown", is_active: true }],
      );
      expect(calculateChargeRateKw(components)).toBeCloseTo(8 * SAFETY, 5);
    });

    it("1 PW3 master + 3 expansions still = 8 * 0.8 (expansions only affect lead rate)", () => {
      const components = makeComponents(
        [{ part_name: "Powerwall 3", is_active: true }],
        Array.from({ length: 3 }, () => ({
          part_name: "Unknown",
          is_active: true,
        })),
      );
      expect(calculateChargeRateKw(components)).toBeCloseTo(8 * SAFETY, 5);
    });
  });

  describe("PW3 systems — multiple masters", () => {
    it("2 PW3 masters, no expansions = (5 + 5) * 0.8 = 8 kW", () => {
      const components = makeComponents(
        [
          { part_name: "Powerwall 3", is_active: true },
          { part_name: "Powerwall 3", is_active: true },
        ],
        [],
      );
      expect(calculateChargeRateKw(components)).toBe(10 * SAFETY);
    });

    it("2 PW3 masters + expansions on lead = (8 + 5) * 0.8 = 10.4 kW", () => {
      const components = makeComponents(
        [
          { part_name: "Powerwall 3", is_active: true },
          { part_name: "Powerwall 3", is_active: true },
        ],
        [{ part_name: "Unknown", is_active: true }],
      );
      expect(calculateChargeRateKw(components)).toBeCloseTo(13 * SAFETY, 5);
    });

    it("ignores inactive PW3 masters", () => {
      const components = makeComponents(
        [
          { part_name: "Powerwall 3", is_active: true },
          { part_name: "Powerwall 3", is_active: false },
        ],
        [],
      );
      expect(calculateChargeRateKw(components)).toBe(5 * SAFETY);
    });
  });

  describe("PW3 presence overrides PW2", () => {
    it("PW3 gateway present → PW2 batteries are ignored in rate calc", () => {
      // Unlikely in practice but guard against mixed configs.
      const components = makeComponents(
        [{ part_name: "Powerwall 3", is_active: true }],
        [{ part_name: "Powerwall 2", is_active: true }],
      );
      // PW3 path: 1 master, 0 expansions (PW2 battery doesn't count as expansion) → 5 * 0.8
      expect(calculateChargeRateKw(components)).toBe(5 * SAFETY);
    });
  });
});

describe("calculateTotalCapacityKwh", () => {
  describe("PW3 systems", () => {
    it("reads nameplate_energy_watts from the lead PW3 gateway and converts to kWh", () => {
      const components: SiteComponents = {
        gateways: [
          {
            device_id: "gw-0",
            part_name: "Powerwall 3",
            is_active: true,
            nameplate_energy_watts: 27000,
          },
        ],
        batteries: [],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(27);
    });

    it("returns 0 when PW3 gateway has no nameplate_energy_watts", () => {
      const components: SiteComponents = {
        gateways: [
          { device_id: "gw-0", part_name: "Powerwall 3", is_active: true },
        ],
        batteries: [],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(0);
    });

    it("ignores inactive PW3 gateways", () => {
      const components: SiteComponents = {
        gateways: [
          {
            device_id: "gw-0",
            part_name: "Powerwall 3",
            is_active: false,
            nameplate_energy_watts: 27000,
          },
        ],
        batteries: [],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(0);
    });

    it("uses the first active PW3 gateway with capacity when multiple exist", () => {
      const components: SiteComponents = {
        gateways: [
          {
            device_id: "gw-0",
            part_name: "Powerwall 3",
            is_active: true,
            nameplate_energy_watts: 27000,
          },
          {
            device_id: "gw-1",
            part_name: "Powerwall 3",
            is_active: true,
            nameplate_energy_watts: 0,
          },
        ],
        batteries: [],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(27);
    });
  });

  describe("PW2 systems", () => {
    it("sums nameplate_energy across active PW2 batteries", () => {
      const components: SiteComponents = {
        gateways: [],
        batteries: [
          {
            device_id: "bat-0",
            part_name: "Powerwall 2",
            is_active: true,
            nameplate_energy: 13500,
          },
          {
            device_id: "bat-1",
            part_name: "Powerwall 2",
            is_active: true,
            nameplate_energy: 13500,
          },
        ],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(27);
    });

    it("ignores inactive PW2 batteries", () => {
      const components: SiteComponents = {
        gateways: [],
        batteries: [
          {
            device_id: "bat-0",
            part_name: "Powerwall 2",
            is_active: true,
            nameplate_energy: 13500,
          },
          {
            device_id: "bat-1",
            part_name: "Powerwall 2",
            is_active: false,
            nameplate_energy: 13500,
          },
        ],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(13.5);
    });

    it("returns 0 when no active batteries have nameplate_energy", () => {
      const components: SiteComponents = {
        gateways: [],
        batteries: [
          { device_id: "bat-0", part_name: "Powerwall 2", is_active: true },
        ],
      };
      expect(calculateTotalCapacityKwh(components)).toBe(0);
    });
  });

  describe("empty / no components", () => {
    it("returns 0 for empty components", () => {
      expect(calculateTotalCapacityKwh({})).toBe(0);
    });
  });
});

describe("calculateGridChargeHours — curve path", () => {
  it("no solar: hours ≈ energyNeededKwh / chargeRateKw + startup buffer", () => {
    // Flat curve at chargeRateKw; no solar → every step contributes stepE/batteryCapKw.
    // Sum reduces to energyNeededKwh / chargeRateKw.
    const curve = makeCurve([
      { soc_percent: 80, battery_kw: 10 },
      { soc_percent: 100, battery_kw: 10 },
    ]);
    const { hours, effectiveRateKw } = calculateGridChargeHours(
      2, // energyNeededKwh (capacityKwh = 2 / 0.1 = 20 kWh)
      0, // estimatedSolarKwh
      80, // currentSoc
      90, // targetSoc (20 steps)
      10, // chargeRateKw
      curve,
    );
    expect(hours).toBeCloseTo(2 / 10 + STARTUP_HOURS, 3);
    expect(effectiveRateKw).toBe(10);
  });

  it("solar rate exceeds battery cap: all steps skipped, returns startup buffer only", () => {
    // solarRateKw = estimatedSolarKwh / seedHours = 3 / (2/10) = 15 kW >> batteryCapKw=10
    // → every step skipped → totalChargeHours = 0
    const curve = makeCurve([
      { soc_percent: 80, battery_kw: 10 },
      { soc_percent: 100, battery_kw: 10 },
    ]);
    const { hours, solarCoversAboveSocPct } = calculateGridChargeHours(
      2, // energyNeededKwh
      3, // estimatedSolarKwh → solarRateKw = 3/(2/10) = 15 kW
      80, // currentSoc
      90, // targetSoc
      10, // chargeRateKw
      curve,
    );
    expect(hours).toBeCloseTo(STARTUP_HOURS, 3);
    // First step (SOC 80) is already skipped → solarCoversAboveSocPct = 80
    expect(solarCoversAboveSocPct).toBe(80);
  });

  it("solar partially helps but battery cap limits: uses batteryCapKw as wall-clock denominator", () => {
    // solarRateKw = 0.4 / (2/10) = 2 kW < batteryCapKw=10 → grid needed for all steps.
    // Wall-clock time = stepE / batteryCapKw (total rate), not stepE / gridRateKw (= 8 kW).
    // Sum = energyNeededKwh / batteryCapKw = 2/10 (same as no-solar case since curve is flat at chargeRateKw).
    const curve = makeCurve([
      { soc_percent: 80, battery_kw: 10 },
      { soc_percent: 100, battery_kw: 10 },
    ]);
    const { hours, effectiveRateKw } = calculateGridChargeHours(
      2, // energyNeededKwh (capacityKwh = 20 kWh)
      0.4, // estimatedSolarKwh → solarRateKw = 0.4/(2/10) = 2 kW
      80, // currentSoc
      90, // targetSoc (20 steps)
      10, // chargeRateKw
      curve,
    );
    // 20 × (0.1 kWh / 10 kW) = 0.2 h + startup
    expect(hours).toBeCloseTo(2 / 10 + STARTUP_HOURS, 3);
    // effectiveRateKw = gridEnergyKwh / chargeHours = (2-0.4) / 0.2 = 8 kW
    expect(effectiveRateKw).toBeCloseTo(8, 1);
  });

  it("solar covers high-SOC CV steps: those steps are skipped, hours is much less than buggy result", () => {
    // solarRateKw = 1.5 / (2/10) = 7.5 kW.
    // Curve: batteryCapKw=10 for SOC 90-92 (> 7.5 → grid); drops to 5 at SOC 93 (< 7.5 → skip).
    // Crossover at ~92.5 SOC (7.5 kW); step at 92.5 is exactly ≤ solarRateKw → also skipped.
    const curve = makeCurve([
      { soc_percent: 90, battery_kw: 10 },
      { soc_percent: 92, battery_kw: 10 },
      { soc_percent: 93, battery_kw: 5 },
      { soc_percent: 100, battery_kw: 5 },
    ]);
    const { hours, solarCoversAboveSocPct } = calculateGridChargeHours(
      2, // energyNeededKwh (capacityKwh = 2/0.04 = 50 kWh)
      1.5, // estimatedSolarKwh → solarRateKw = 7.5 kW
      90, // currentSoc
      94, // targetSoc (8 steps: 90, 90.5, …, 93.5)
      10, // chargeRateKw
      curve,
    );
    // 5 grid steps (SOC 90..92) × (0.25 kWh / 10 kW) = 0.125 h + startup
    // Old buggy code would produce ~8 h (dividing by near-zero gridRateKw for high-SOC steps).
    expect(hours).toBeCloseTo(0.125 + STARTUP_HOURS, 3);
    expect(hours).toBeLessThan(1);
    // First skipped step is at SOC 92.5 (interpolated to exactly 7.5 kW = solarRateKw).
    expect(solarCoversAboveSocPct).toBe(92.5);
  });

  it("no curve: solarCoversAboveSocPct is undefined", () => {
    const { hours, solarCoversAboveSocPct } = calculateGridChargeHours(
      2,
      0,
      80,
      90,
      10,
    );
    expect(hours).toBeGreaterThan(0);
    expect(solarCoversAboveSocPct).toBeUndefined();
  });
});
