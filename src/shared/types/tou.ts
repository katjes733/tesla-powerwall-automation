import { v4 as uuidv4 } from "uuid";

export type PeriodType =
  | "ON_PEAK"
  | "OFF_PEAK"
  | "PARTIAL_PEAK"
  | "SUPER_OFF_PEAK";

export const ALL_PERIOD_TYPES: PeriodType[] = [
  "ON_PEAK",
  "OFF_PEAK",
  "PARTIAL_PEAK",
  "SUPER_OFF_PEAK",
];

export const PERIOD_COLORS: Record<PeriodType, string> = {
  ON_PEAK: "#ef5350",
  OFF_PEAK: "#42a5f5",
  PARTIAL_PEAK: "#ffa726",
  SUPER_OFF_PEAK: "#66bb6a",
};

export const PERIOD_LABELS: Record<PeriodType, string> = {
  ON_PEAK: "On-Peak",
  OFF_PEAK: "Off-Peak",
  PARTIAL_PEAK: "Partial Peak",
  SUPER_OFF_PEAK: "Super Off-Peak",
};

// 0=Mon … 6=Sun (Tesla ISO convention)
export interface TouTimeBlock {
  id: string;
  type: PeriodType;
  fromDayOfWeek: number;
  toDayOfWeek: number;
  fromHour: number;
  fromMinute: number;
  toHour: number;
  toMinute: number;
}

export interface TouSeasonRates {
  buy: Partial<Record<PeriodType, number>>;
  sell: Partial<Record<PeriodType, number>>;
}

export interface TouSeason {
  id: string;
  name: string;
  fromMonth: number;
  fromDay: number;
  toMonth: number;
  toDay: number;
  periods: TouTimeBlock[];
  rates: TouSeasonRates;
}

export interface TouEditorState {
  tariffName: string;
  utility: string;
  seasons: TouSeason[];
  sellTariffSynced: boolean;
}

export function emptyEditorState(): TouEditorState {
  return {
    tariffName: "",
    utility: "",
    seasons: [],
    sellTariffSynced: true,
  };
}

function normalisePeriods(raw: unknown): TouTimeBlock[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.periods)
      ? (raw as any).periods
      : [];

  return arr
    .filter((p): p is Record<string, any> => !!p && typeof p === "object")
    .map((p) => ({
      id: uuidv4(),
      type: (p.type ?? "OFF_PEAK") as PeriodType,
      fromDayOfWeek: p.fromDayOfWeek ?? 0,
      toDayOfWeek: p.toDayOfWeek ?? 6,
      fromHour: p.fromHour ?? 0,
      fromMinute: p.fromMinute ?? 0,
      toHour: p.toHour ?? 0,
      toMinute: p.toMinute ?? 0,
    }));
}

function extractPeriodsFromSeason(
  rawSeason: Record<string, any>,
): TouTimeBlock[] {
  const touPeriods: Record<string, unknown> = rawSeason.tou_periods ?? {};
  const blocks: TouTimeBlock[] = [];
  for (const [label, raw] of Object.entries(touPeriods)) {
    const type = label as PeriodType;
    const periods = normalisePeriods(raw);
    for (const p of periods) {
      blocks.push({ ...p, type });
    }
  }
  return blocks;
}

function extractRatesFromCharges(
  energyCharges: Record<string, any>,
  seasonName: string,
): {
  buy: Partial<Record<PeriodType, number>>;
  sell?: Partial<Record<PeriodType, number>>;
} {
  const seasonRates = energyCharges?.[seasonName]?.rates ?? {};
  const buy: Partial<Record<PeriodType, number>> = {};
  for (const [k, v] of Object.entries(seasonRates)) {
    if (k !== "ALL" && typeof v === "number") {
      buy[k as PeriodType] = v;
    }
  }
  return { buy };
}

function seasonsAreStructurallyEqual(
  buySeasons: Record<string, any>,
  sellSeasons: Record<string, any>,
): boolean {
  const buyKeys = Object.keys(buySeasons).sort();
  const sellKeys = Object.keys(sellSeasons).sort();
  if (buyKeys.join(",") !== sellKeys.join(",")) return false;
  for (const key of buyKeys) {
    const b = buySeasons[key];
    const s = sellSeasons[key];
    if (
      b?.fromMonth !== s?.fromMonth ||
      b?.fromDay !== s?.fromDay ||
      b?.toMonth !== s?.toMonth ||
      b?.toDay !== s?.toDay
    )
      return false;
  }
  return true;
}

export function tariffV2ToEditorState(raw: unknown): TouEditorState {
  if (!raw || typeof raw !== "object") return emptyEditorState();
  const v2 = raw as Record<string, any>;

  const buySeasons: Record<string, any> = v2.seasons ?? {};
  const sellSeasons: Record<string, any> = v2.sell_tariff?.seasons ?? {};
  const sellSynced =
    !v2.sell_tariff || seasonsAreStructurallyEqual(buySeasons, sellSeasons);

  const energyCharges: Record<string, any> = v2.energy_charges ?? {};
  const sellEnergyCharges: Record<string, any> =
    v2.sell_tariff?.energy_charges ?? {};

  const seasons: TouSeason[] = Object.entries(buySeasons).map(
    ([name, rawSeason]) => {
      const s = rawSeason as Record<string, any>;
      const { buy } = extractRatesFromCharges(energyCharges, name);
      const { buy: sell } = extractRatesFromCharges(sellEnergyCharges, name);
      return {
        id: uuidv4(),
        name,
        fromMonth: s.fromMonth ?? 1,
        fromDay: s.fromDay ?? 1,
        toMonth: s.toMonth ?? 12,
        toDay: s.toDay ?? 31,
        periods: extractPeriodsFromSeason(s),
        rates: { buy, sell },
      };
    },
  );

  return {
    tariffName: v2.name ?? "",
    utility: v2.utility ?? "",
    seasons,
    sellTariffSynced: sellSynced,
  };
}

function buildTouPeriods(
  periods: TouTimeBlock[],
): Record<string, { periods: Omit<TouTimeBlock, "id" | "type">[] }> {
  const grouped: Record<string, Omit<TouTimeBlock, "id" | "type">[]> = {};
  for (const block of periods) {
    const { id: _id, type, ...rest } = block;
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(rest);
  }
  const result: Record<
    string,
    { periods: Omit<TouTimeBlock, "id" | "type">[] }
  > = {};
  for (const [label, ps] of Object.entries(grouped)) {
    result[label] = { periods: ps };
  }
  return result;
}

function buildEnergyCharges(
  seasons: TouSeason[],
  rateKey: "buy" | "sell",
): Record<string, any> {
  const charges: Record<string, any> = {
    ALL: { rates: { ALL: 0 } },
  };
  for (const season of seasons) {
    const rates = season.rates[rateKey];
    const ratesObj: Record<string, number> = {};
    for (const [k, v] of Object.entries(rates ?? {})) {
      if (v !== undefined) ratesObj[k] = v;
    }
    charges[season.name] = { rates: ratesObj };
  }
  return charges;
}

function buildSeasons(seasons: TouSeason[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const season of seasons) {
    result[season.name] = {
      fromMonth: season.fromMonth,
      fromDay: season.fromDay,
      toMonth: season.toMonth,
      toDay: season.toDay,
      tou_periods: buildTouPeriods(season.periods),
    };
  }
  return result;
}

export function editorStateToTariffV2(
  state: TouEditorState,
): Record<string, unknown> {
  const seasonNames = state.seasons.map((s) => s.name);
  const demandCharges: Record<string, any> = { ALL: { rates: { ALL: 0 } } };
  for (const name of seasonNames) {
    demandCharges[name] = {};
  }

  const buySeasonsObj = buildSeasons(state.seasons);
  const energyCharges = buildEnergyCharges(state.seasons, "buy");
  const sellEnergyCharges = buildEnergyCharges(state.seasons, "sell");

  const v2: Record<string, unknown> = {
    name: state.tariffName,
    utility: state.utility,
    daily_charges: [{ name: "Charge" }],
    demand_charges: demandCharges,
    energy_charges: energyCharges,
    seasons: buySeasonsObj,
    sell_tariff: {
      name: state.tariffName,
      utility: state.utility,
      daily_charges: [{ name: "Charge" }],
      demand_charges: demandCharges,
      energy_charges: sellEnergyCharges,
      seasons: buySeasonsObj,
    },
    version: 1,
  };

  return v2;
}
