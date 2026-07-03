import type { SiteComponents } from "~/server/types/common";
import {
  lookupBatteryRateKw,
  type ChargeCurveCalibrationData,
} from "~/server/util/curveFit";

const SAFETY_FACTOR = 0.8;
const PW3_LEAD_WITH_EXPANSION_KW = 8;
const PW3_MASTER_KW = 5;
const PW2_BATTERY_KW = 5;

/**
 * Returns total usable battery capacity in kWh.
 * PW3: nameplate_energy_watts (Wh) on the lead gateway covers the whole system.
 * PW2: nameplate_energy (Wh) on each battery pod; summed across active units.
 * Returns 0 if the API does not expose capacity for this configuration.
 */
export function calculateTotalCapacityKwh(components: SiteComponents): number {
  const gateways = (components.gateways ?? []).filter((g) => g.is_active);
  const batteries = (components.batteries ?? []).filter((b) => b.is_active);

  const pw3Lead = gateways.find(
    (g) => g.part_name === "Powerwall 3" && (g.nameplate_energy_watts ?? 0) > 0,
  );
  if (pw3Lead) {
    return pw3Lead.nameplate_energy_watts! / 1000;
  }

  const pw2TotalWh = batteries
    .filter((b) => b.part_name === "Powerwall 2")
    .reduce((sum, b) => sum + (b.nameplate_energy ?? 0), 0);
  return pw2TotalWh / 1000;
}

export function calculateChargeRateKw(components: SiteComponents): number {
  const gateways = (components.gateways ?? []).filter((g) => g.is_active);
  const batteries = (components.batteries ?? []).filter((b) => b.is_active);

  const pw3Masters = gateways.filter((g) => g.part_name === "Powerwall 3");

  if (pw3Masters.length > 0) {
    // Expansion packs always connect to the lead master and have part_name "Unknown".
    const expansionCount = batteries.filter(
      (b) => b.part_name === "Unknown",
    ).length;
    const leadRateKw =
      expansionCount > 0 ? PW3_LEAD_WITH_EXPANSION_KW : PW3_MASTER_KW;
    const additionalMastersRateKw = (pw3Masters.length - 1) * PW3_MASTER_KW;
    return (leadRateKw + additionalMastersRateKw) * SAFETY_FACTOR;
  }

  const pw2Count = batteries.filter(
    (b) => b.part_name === "Powerwall 2",
  ).length;
  return pw2Count * PW2_BATTERY_KW * SAFETY_FACTOR;
}

// SOC at which the Powerwall CV taper begins (rate still ~full at 95% in observed data).
export const HIGH_SOC_TAPER_SOC_PERCENT = 95;
// Exponential decay constant per %SOC — fitted from observed data:
// rate ≈ 16kW at 95% SOC, ≈ 10.3kW at 97% SOC → k = ln(16/10.3) / 2 ≈ 0.222
export const HIGH_SOC_TAPER_K = 0.222;
// Grid charging takes 1–2 min to ramp up after being enabled.
export const GRID_CHARGE_STARTUP_BUFFER_MINUTES = 2;
// Stop targeting 100% SOC this many minutes before the on-peak start / charge deadline.
// Ensures the battery is full before grid charging is cut off, avoiding a race with
// demand managers that may not be perfectly synchronised with the Powerwall.
export const PEAK_BUFFER_MINUTES = 5;

/**
 * Effective charge rate (kW) for the CV taper zone [soc1, soc2].
 * The actual rate decays exponentially: rate(SOC) = chargeRateKw × exp(−k × (SOC − taperSOC)).
 * This returns the harmonic-weighted average over the range (= total energy ÷ total time),
 * which is what we need for calculating how long the grid must run.
 * Battery capacity cancels out — result depends only on the SOC bounds and chargeRateKw.
 */
function cvEffectiveRateKw(
  chargeRateKw: number,
  soc1: number,
  soc2: number,
): number {
  if (soc1 >= soc2) return chargeRateKw;
  const u1 = soc1 - HIGH_SOC_TAPER_SOC_PERCENT;
  const u2 = soc2 - HIGH_SOC_TAPER_SOC_PERCENT;
  return (
    (chargeRateKw * HIGH_SOC_TAPER_K * (u2 - u1)) /
    (Math.exp(HIGH_SOC_TAPER_K * u2) - Math.exp(HIGH_SOC_TAPER_K * u1))
  );
}

/**
 * Calculates the total hours the grid must charge to deliver the required energy,
 * accounting for the CC/CV taper above HIGH_SOC_TAPER_SOC_PERCENT and a fixed startup buffer.
 * Solar is allocated to the CC phase first (solar accumulates throughout the day, well
 * before the grid-charging window at the end of off-peak).
 * Returns the effective rate (kW) for use in log/reason strings.
 *
 * When a non-parametric charge curve is provided, numerical integration over the SOC
 * range replaces the hardcoded CC/CV model. Existing callers that omit `curve` are unaffected.
 */
export interface GridChargeHoursResult {
  hours: number;
  effectiveRateKw: number;
  /** Lowest SOC step where solar alone covers the battery — set only when a
   *  calibrated charge curve is used. Undefined means grid is needed all the
   *  way to targetSoc (or no curve was available). */
  solarCoversAboveSocPct?: number;
}

export function calculateGridChargeHours(
  energyNeededKwh: number,
  estimatedSolarKwh: number,
  currentSocPercent: number,
  targetSocPercent: number,
  chargeRateKw: number,
  curve?: ChargeCurveCalibrationData,
): GridChargeHoursResult {
  const gridEnergyKwh = Math.max(0, energyNeededKwh - estimatedSolarKwh);
  const startupBufferHours = GRID_CHARGE_STARTUP_BUFFER_MINUTES / 60;

  if (curve && curve.bins.length > 0) {
    return calculateGridChargeHoursCurve(
      energyNeededKwh,
      estimatedSolarKwh,
      currentSocPercent,
      targetSocPercent,
      chargeRateKw,
      curve,
      gridEnergyKwh,
      startupBufferHours,
    );
  }

  const taperStartSoc = Math.max(currentSocPercent, HIGH_SOC_TAPER_SOC_PERCENT);
  const cvSocDelta = Math.max(0, targetSocPercent - taperStartSoc);
  const totalSocDelta = Math.max(0, targetSocPercent - currentSocPercent);

  if (totalSocDelta <= 0 || cvSocDelta <= 0) {
    return {
      hours: gridEnergyKwh / chargeRateKw + startupBufferHours,
      effectiveRateKw: chargeRateKw,
    };
  }

  const cvFraction = cvSocDelta / totalSocDelta;
  const cvEnergyKwh = energyNeededKwh * cvFraction;
  const ccEnergyKwh = energyNeededKwh - cvEnergyKwh;

  const ccGridEnergy = Math.max(0, ccEnergyKwh - estimatedSolarKwh);
  const cvGridEnergy = Math.max(
    0,
    cvEnergyKwh - Math.max(0, estimatedSolarKwh - ccEnergyKwh),
  );

  const cvRate = cvEffectiveRateKw(
    chargeRateKw,
    taperStartSoc,
    targetSocPercent,
  );
  const chargeHours = ccGridEnergy / chargeRateKw + cvGridEnergy / cvRate;
  const totalHours = chargeHours + startupBufferHours;

  const effectiveRateKw =
    gridEnergyKwh > 0
      ? Math.round((gridEnergyKwh / chargeHours) * 100) / 100
      : chargeRateKw;

  return { hours: totalHours, effectiveRateKw };
}

const CURVE_STEP_SOC = 0.5;
const CAPACITY_KWH_FALLBACK = 13.5;

function calculateGridChargeHoursCurve(
  energyNeededKwh: number,
  estimatedSolarKwh: number,
  currentSocPercent: number,
  targetSocPercent: number,
  chargeRateKw: number,
  curve: ChargeCurveCalibrationData,
  gridEnergyKwh: number,
  startupBufferHours: number,
): GridChargeHoursResult {
  const totalSocDelta = Math.max(0, targetSocPercent - currentSocPercent);
  if (totalSocDelta <= 0) {
    return { hours: startupBufferHours, effectiveRateKw: chargeRateKw };
  }

  // Estimate capacity from energyNeededKwh / totalSocDelta ratio, fallback to known default.
  const capacityKwh =
    totalSocDelta > 0
      ? energyNeededKwh / (totalSocDelta / 100)
      : CAPACITY_KWH_FALLBACK;

  // Seed hours for solar rate estimate: rough estimate using chargeRateKw.
  const seedHours =
    ((totalSocDelta / 100) * capacityKwh) / Math.max(0.1, chargeRateKw);
  const solarRateKw = seedHours > 0 ? estimatedSolarKwh / seedHours : 0;

  let totalChargeHours = 0;
  let solarCoversAboveSocPct: number | undefined;
  const steps = Math.ceil(totalSocDelta / CURVE_STEP_SOC);
  const stepEnergyKwh = capacityKwh * (CURVE_STEP_SOC / 100);

  for (let i = 0; i < steps; i++) {
    const soc = currentSocPercent + i * CURVE_STEP_SOC;
    const batteryCapKw = lookupBatteryRateKw(soc, curve.bins);

    if (batteryCapKw <= solarRateKw) {
      // Solar covers this SOC step entirely — grid not needed here.
      if (solarCoversAboveSocPct === undefined) {
        solarCoversAboveSocPct = soc;
      }
      continue;
    }

    // Grid is ON for this step. Wall-clock time = step energy / total charge rate.
    // Total rate = solar + grid contribution, capped at battery acceptance = batteryCapKw.
    totalChargeHours += stepEnergyKwh / Math.max(0.1, batteryCapKw);
  }

  const totalHours = totalChargeHours + startupBufferHours;
  const effectiveRateKw =
    gridEnergyKwh > 0 && totalChargeHours > 0
      ? Math.round((gridEnergyKwh / totalChargeHours) * 100) / 100
      : chargeRateKw;

  return { hours: totalHours, effectiveRateKw, solarCoversAboveSocPct };
}
