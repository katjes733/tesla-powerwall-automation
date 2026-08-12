/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PowerwallTab from "~/client/components/history/PowerwallTab";
import type { PowerHistoryPoint } from "~/client/components/history/energyUtils";

// Same fixture as HomeTab.test.tsx — see that file for the kWh derivation.
// discharge = 0.5 kWh, charge = 1 kWh.
const POINTS: PowerHistoryPoint[] = [
  {
    timestamp: "2026-01-01T00:00:00Z",
    solar_power: 12000,
    battery_power: 6000,
    grid_power: -6000,
    load_power: 12000,
  },
  {
    timestamp: "2026-01-01T00:05:00Z",
    solar_power: 0,
    battery_power: -12000,
    grid_power: 12000,
    load_power: 0,
  },
];

describe("PowerwallTab — totals above the chart", () => {
  it("pairs the up arrow with Discharged and the down arrow with Charged", () => {
    render(<PowerwallTab points={POINTS} socPoints={[]} timezone="UTC" />);

    const dischargedBlock =
      screen.getByText("Discharged").parentElement!.parentElement!;
    expect(
      within(dischargedBlock).getByTestId("ArrowUpwardIcon"),
    ).toBeInTheDocument();
    expect(within(dischargedBlock).getByText("0.50 kWh")).toBeInTheDocument();

    const chargedBlock =
      screen.getByText("Charged").parentElement!.parentElement!;
    expect(
      within(chargedBlock).getByTestId("ArrowDownwardIcon"),
    ).toBeInTheDocument();
    expect(within(chargedBlock).getByText("1.00 kWh")).toBeInTheDocument();
  });
});
