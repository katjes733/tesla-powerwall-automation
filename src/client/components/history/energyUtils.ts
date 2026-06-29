export interface PowerHistoryPoint {
  timestamp: string;
  solar_power: number;
  battery_power: number;
  grid_power: number;
  load_power: number;
}

export interface SocPoint {
  timestamp: string;
  soc_percent: number;
}

export interface HistoryData {
  date: string;
  points: PowerHistoryPoint[];
  socPoints: SocPoint[];
  cached: boolean;
}

export const COLORS = {
  home: "#60a5fa",
  solar: "#fbbf24",
  batteryDischarge: "#34d399",
  batteryCharge: "#60a5fa",
  gridImport: "#fb923c",
  gridExport: "#a78bfa",
  soc: "#34d399",
} as const;

const KWH_FACTOR = 1 / 12 / 1000; // 5-min intervals → kWh

export interface EnergyStats {
  solarKwh: number;
  dischargeKwh: number;
  chargeKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  homeKwh: number;
  energyIn: number;
  energyOut: number;
}

export function computeEnergyStats(points: PowerHistoryPoint[]): EnergyStats {
  let solar = 0,
    discharge = 0,
    charge = 0,
    gridImport = 0,
    gridExport = 0,
    home = 0;

  for (const p of points) {
    solar += p.solar_power;
    discharge += Math.max(0, p.battery_power);
    charge += Math.max(0, -p.battery_power);
    gridImport += Math.max(0, p.grid_power);
    gridExport += Math.max(0, -p.grid_power);
    home += p.load_power;
  }

  const solarKwh = solar * KWH_FACTOR;
  const dischargeKwh = discharge * KWH_FACTOR;
  const chargeKwh = charge * KWH_FACTOR;
  const gridImportKwh = gridImport * KWH_FACTOR;
  const gridExportKwh = gridExport * KWH_FACTOR;
  const homeKwh = home * KWH_FACTOR;

  return {
    solarKwh,
    dischargeKwh,
    chargeKwh,
    gridImportKwh,
    gridExportKwh,
    homeKwh,
    energyIn: solarKwh + gridImportKwh + dischargeKwh,
    energyOut: homeKwh + chargeKwh + gridExportKwh,
  };
}

// Proportional mixing: fraction of a source flowing to a given load.
// energyIn = sum of all sources; energyOut = sum of all loads.
export function mixFraction(
  sourceKwh: number,
  loadKwh: number,
  energyIn: number,
  energyOut: number,
): number {
  if (energyIn <= 0 || energyOut <= 0) return 0;
  return (sourceKwh / energyIn) * loadKwh;
}

export function toChartTime(timestamp: string): number {
  return new Date(timestamp).getTime();
}

export function withPercents<T extends { kwh: number }>(
  items: T[],
): (T & { percent: number })[] {
  const total = items.reduce((s, i) => s + i.kwh, 0);
  const safe = total > 0 ? total : 1;
  return items.map((i) => ({ ...i, percent: (i.kwh / safe) * 100 }));
}
