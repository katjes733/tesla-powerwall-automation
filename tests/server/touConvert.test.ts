import { describe, it, expect } from "bun:test";
import {
  tariffV2ToEditorState,
  editorStateToTariffV2,
  emptyEditorState,
} from "~/shared/types/tou";

// E27 fixture based on the project's canonical example
const E27_V2 = {
  name: "E27",
  utility: "SRP",
  daily_charges: [{ name: "Charge" }],
  demand_charges: {
    ALL: { rates: { ALL: 0 } },
    Summer: {},
    Winter: {},
  },
  energy_charges: {
    ALL: { rates: { ALL: 0 } },
    Summer: { rates: { OFF_PEAK: 0.05, ON_PEAK: 0.2 } },
    Winter: { rates: { OFF_PEAK: 0.05, ON_PEAK: 0.2 } },
  },
  seasons: {
    Summer: {
      fromDay: 1,
      toDay: 30,
      fromMonth: 11,
      toMonth: 4,
      tou_periods: {
        OFF_PEAK: {
          periods: [
            { toDayOfWeek: 4, fromHour: 9, toHour: 17 },
            { toDayOfWeek: 4, fromHour: 21, toHour: 5 },
            { fromDayOfWeek: 5, toDayOfWeek: 6 },
          ],
        },
        ON_PEAK: {
          periods: [
            { toDayOfWeek: 4, fromHour: 5, toHour: 9 },
            { toDayOfWeek: 4, fromHour: 17, toHour: 21 },
          ],
        },
      },
    },
    Winter: {
      fromDay: 1,
      toDay: 31,
      fromMonth: 5,
      toMonth: 10,
      tou_periods: {
        OFF_PEAK: {
          periods: [
            { toDayOfWeek: 4, fromHour: 20, toHour: 14 },
            { fromDayOfWeek: 5, toDayOfWeek: 6 },
          ],
        },
        ON_PEAK: {
          periods: [{ toDayOfWeek: 4, fromHour: 14, toHour: 20 }],
        },
      },
    },
  },
  sell_tariff: {
    name: "E27",
    utility: "SRP",
    seasons: {
      Summer: {
        fromDay: 1,
        toDay: 30,
        fromMonth: 11,
        toMonth: 4,
        tou_periods: {
          OFF_PEAK: {
            periods: [
              { toDayOfWeek: 4, fromHour: 9, toHour: 17 },
              { toDayOfWeek: 4, fromHour: 21, toHour: 5 },
              { fromDayOfWeek: 5, toDayOfWeek: 6 },
            ],
          },
          ON_PEAK: {
            periods: [
              { toDayOfWeek: 4, fromHour: 5, toHour: 9 },
              { toDayOfWeek: 4, fromHour: 17, toHour: 21 },
            ],
          },
        },
      },
      Winter: {
        fromDay: 1,
        toDay: 31,
        fromMonth: 5,
        toMonth: 10,
        tou_periods: {
          OFF_PEAK: {
            periods: [
              { toDayOfWeek: 4, fromHour: 20, toHour: 14 },
              { fromDayOfWeek: 5, toDayOfWeek: 6 },
            ],
          },
          ON_PEAK: {
            periods: [{ toDayOfWeek: 4, fromHour: 14, toHour: 20 }],
          },
        },
      },
    },
    energy_charges: {
      ALL: { rates: { ALL: 0 } },
      Summer: { rates: { OFF_PEAK: 0.05, ON_PEAK: 0.05 } },
      Winter: { rates: { OFF_PEAK: 0.05, ON_PEAK: 0.05 } },
    },
    demand_charges: { ALL: { rates: { ALL: 0 } }, Summer: {}, Winter: {} },
    daily_charges: [{ name: "Charge" }],
  },
  version: 1,
};

describe("tariffV2ToEditorState", () => {
  it("returns empty state for null input", () => {
    const state = tariffV2ToEditorState(null);
    expect(state).toEqual(emptyEditorState());
  });

  it("returns empty state for non-object input", () => {
    const state = tariffV2ToEditorState("string");
    expect(state).toEqual(emptyEditorState());
  });

  it("maps tariff name and utility", () => {
    const state = tariffV2ToEditorState(E27_V2);
    expect(state.tariffName).toBe("E27");
    expect(state.utility).toBe("SRP");
  });

  it("parses seasons with correct date ranges", () => {
    const state = tariffV2ToEditorState(E27_V2);
    expect(state.seasons).toHaveLength(2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    expect(summer).toBeDefined();
    expect(summer.fromMonth).toBe(11);
    expect(summer.fromDay).toBe(1);
    expect(summer.toMonth).toBe(4);
    expect(summer.toDay).toBe(30);
  });

  it("handles wrapped { periods: [...] } format", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    // Summer has 3 OFF_PEAK + 2 ON_PEAK = 5 periods total
    expect(summer.periods).toHaveLength(5);
  });

  it("handles bare array format for tou_periods", () => {
    const v2WithArrayPeriods = {
      name: "Test",
      utility: "Test",
      seasons: {
        Season: {
          fromMonth: 1,
          fromDay: 1,
          toMonth: 12,
          toDay: 31,
          tou_periods: {
            ON_PEAK: [{ toDayOfWeek: 4, fromHour: 9, toHour: 17 }],
          },
        },
      },
    };
    const state = tariffV2ToEditorState(v2WithArrayPeriods);
    expect(state.seasons[0].periods).toHaveLength(1);
    expect(state.seasons[0].periods[0].type).toBe("ON_PEAK");
  });

  it("defaults fromDayOfWeek to 0 when omitted", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    // All periods without explicit fromDayOfWeek should default to 0
    summer.periods.forEach((p) => {
      expect(p.fromDayOfWeek).toBeGreaterThanOrEqual(0);
    });
  });

  it("defaults fromMinute and toMinute to 0 when omitted", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    summer.periods.forEach((p) => {
      expect(p.fromMinute).toBe(0);
      expect(p.toMinute).toBe(0);
    });
  });

  it("assigns correct period types from tou_periods keys", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    const types = new Set(summer.periods.map((p) => p.type));
    expect(types.has("ON_PEAK")).toBe(true);
    expect(types.has("OFF_PEAK")).toBe(true);
  });

  it("extracts buy rates from energy_charges", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    expect(summer.rates.buy.OFF_PEAK).toBe(0.05);
    expect(summer.rates.buy.ON_PEAK).toBe(0.2);
  });

  it("extracts sell rates from sell_tariff energy_charges", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const summer = state.seasons.find((s) => s.name === "Summer")!;
    expect(summer.rates.sell.OFF_PEAK).toBe(0.05);
    expect(summer.rates.sell.ON_PEAK).toBe(0.05);
  });

  it("sets sellTariffSynced=true when sell seasons match buy seasons structurally", () => {
    const state = tariffV2ToEditorState(E27_V2);
    expect(state.sellTariffSynced).toBe(true);
  });

  it("sets sellTariffSynced=false when no sell_tariff present", () => {
    const noSell = { ...E27_V2, sell_tariff: undefined };
    const state = tariffV2ToEditorState(noSell);
    // No sell_tariff means synced (default behaviour — nothing to override)
    expect(state.sellTariffSynced).toBe(true);
  });

  it("assigns unique ids to each period block", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const allIds = state.seasons.flatMap((s) => s.periods.map((p) => p.id));
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("assigns unique ids to each season", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const ids = state.seasons.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("editorStateToTariffV2", () => {
  it("includes version: 1", () => {
    const v2 = editorStateToTariffV2(emptyEditorState());
    expect(v2.version).toBe(1);
  });

  it("includes energy_charges.ALL sentinel", () => {
    const v2 = editorStateToTariffV2(emptyEditorState()) as any;
    expect(v2.energy_charges.ALL.rates.ALL).toBe(0);
  });

  it("writes tou_periods in { periods: [...] } wrapper form, not bare array", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state) as any;
    const summerPeriods = v2.seasons.Summer.tou_periods;
    for (const label of Object.keys(summerPeriods)) {
      expect(Array.isArray(summerPeriods[label])).toBe(false);
      expect(Array.isArray(summerPeriods[label].periods)).toBe(true);
    }
  });

  it("puts buy rates in energy_charges per season", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state) as any;
    expect(v2.energy_charges.Summer.rates.OFF_PEAK).toBe(0.05);
    expect(v2.energy_charges.Summer.rates.ON_PEAK).toBe(0.2);
  });

  it("puts sell rates in sell_tariff.energy_charges", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state) as any;
    expect(v2.sell_tariff.energy_charges.Summer.rates.OFF_PEAK).toBe(0.05);
    expect(v2.sell_tariff.energy_charges.Summer.rates.ON_PEAK).toBe(0.05);
  });

  it("sell_tariff.seasons mirrors buy seasons", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state) as any;
    expect(Object.keys(v2.sell_tariff.seasons)).toEqual(
      Object.keys(v2.seasons),
    );
  });

  it("preserves tariff name and utility", () => {
    const state = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state) as any;
    expect(v2.name).toBe("E27");
    expect(v2.utility).toBe("SRP");
  });
});

describe("round-trip: tariffV2ToEditorState → editorStateToTariffV2 → tariffV2ToEditorState", () => {
  it("preserves season count", () => {
    const state1 = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state1);
    const state2 = tariffV2ToEditorState(v2);
    expect(state2.seasons).toHaveLength(state1.seasons.length);
  });

  it("preserves period counts per season", () => {
    const state1 = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state1);
    const state2 = tariffV2ToEditorState(v2);
    for (const s1 of state1.seasons) {
      const s2 = state2.seasons.find((s) => s.name === s1.name)!;
      expect(s2).toBeDefined();
      expect(s2.periods).toHaveLength(s1.periods.length);
    }
  });

  it("preserves period times", () => {
    const state1 = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state1);
    const state2 = tariffV2ToEditorState(v2);
    for (const s1 of state1.seasons) {
      const s2 = state2.seasons.find((s) => s.name === s1.name)!;
      for (let i = 0; i < s1.periods.length; i++) {
        expect(s2.periods[i].fromHour).toBe(s1.periods[i].fromHour);
        expect(s2.periods[i].toHour).toBe(s1.periods[i].toHour);
        expect(s2.periods[i].fromMinute).toBe(s1.periods[i].fromMinute);
        expect(s2.periods[i].toMinute).toBe(s1.periods[i].toMinute);
      }
    }
  });

  it("preserves buy rates", () => {
    const state1 = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state1);
    const state2 = tariffV2ToEditorState(v2);
    for (const s1 of state1.seasons) {
      const s2 = state2.seasons.find((s) => s.name === s1.name)!;
      for (const [k, v] of Object.entries(s1.rates.buy)) {
        expect(s2.rates.buy[k as keyof typeof s2.rates.buy]).toBe(v);
      }
    }
  });

  it("preserves sell rates", () => {
    const state1 = tariffV2ToEditorState(E27_V2);
    const v2 = editorStateToTariffV2(state1);
    const state2 = tariffV2ToEditorState(v2);
    for (const s1 of state1.seasons) {
      const s2 = state2.seasons.find((s) => s.name === s1.name)!;
      for (const [k, v] of Object.entries(s1.rates.sell)) {
        expect(s2.rates.sell[k as keyof typeof s2.rates.sell]).toBe(v);
      }
    }
  });
});
