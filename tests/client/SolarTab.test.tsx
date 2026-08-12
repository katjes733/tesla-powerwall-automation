/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SolarTab from "~/client/components/history/SolarTab";
import type { PowerHistoryPoint } from "~/client/components/history/energyUtils";

// Same fixture as HomeTab.test.tsx — see that file for the kWh derivation.
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

describe("SolarTab — totals above the chart", () => {
  it("shows total solar generation for the day", () => {
    render(<SolarTab points={POINTS} timezone="UTC" />);
    expect(screen.getByText("Total Generated")).toBeInTheDocument();
    expect(screen.getByText("1.00 kWh")).toBeInTheDocument();
  });

  it("has no arrow icon — this is a single-direction total, not a flow", () => {
    render(<SolarTab points={POINTS} timezone="UTC" />);
    expect(screen.queryByTestId("ArrowUpwardIcon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ArrowDownwardIcon")).not.toBeInTheDocument();
  });
});
