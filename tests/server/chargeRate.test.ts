import { describe, it, expect } from "bun:test";
import {
  calculateChargeRateKw,
  calculateTotalCapacityKwh,
} from "~/server/util/chargeRate";
import type { SiteComponents } from "~/server/types/common";

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
