import type { SiteComponents } from "~/server/types/common";

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
