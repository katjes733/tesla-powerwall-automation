/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HomeTab from "~/client/components/history/HomeTab";
import type { PowerHistoryPoint } from "~/client/components/history/energyUtils";

// Two 5-min points chosen so KWH_FACTOR (1/12/1000) lands on clean numbers:
// solar 1 kWh, discharge 0.5 kWh, charge 1 kWh, grid import 1 kWh, grid
// export 0.5 kWh, home 1 kWh.
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

describe("HomeTab — totals above the chart", () => {
  it("shows total home consumption for the day", () => {
    render(<HomeTab points={POINTS} timezone="UTC" />);
    expect(screen.getByText("Total used")).toBeInTheDocument();
    expect(screen.getByText("1.00 kWh")).toBeInTheDocument();
  });

  it("has no arrow icon — this is a single-direction total, not a flow", () => {
    render(<HomeTab points={POINTS} timezone="UTC" />);
    expect(screen.queryByTestId("ArrowUpwardIcon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ArrowDownwardIcon")).not.toBeInTheDocument();
  });
});
