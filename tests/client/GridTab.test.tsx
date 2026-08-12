/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GridTab from "~/client/components/history/GridTab";
import type { PowerHistoryPoint } from "~/client/components/history/energyUtils";

// Same fixture as HomeTab.test.tsx — see that file for the kWh derivation.
// grid import = 1 kWh, grid export = 0.5 kWh.
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

describe("GridTab — totals above the chart", () => {
  it("pairs the up arrow with Imported and the down arrow with Exported", () => {
    render(<GridTab points={POINTS} timezone="UTC" />);

    const importedBlock =
      screen.getByText("Imported").parentElement!.parentElement!;
    expect(
      within(importedBlock).getByTestId("ArrowUpwardIcon"),
    ).toBeInTheDocument();
    expect(within(importedBlock).getByText("1.00 kWh")).toBeInTheDocument();

    const exportedBlock =
      screen.getByText("Exported").parentElement!.parentElement!;
    expect(
      within(exportedBlock).getByTestId("ArrowDownwardIcon"),
    ).toBeInTheDocument();
    expect(within(exportedBlock).getByText("0.50 kWh")).toBeInTheDocument();
  });
});
