/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import EnergyFlow from "~/client/components/powerwall/EnergyFlow";

const theme = createTheme();

interface Props {
  solar: number;
  grid: number;
  battery: number;
  home: number;
}

function renderFlow({ solar, grid, battery, home }: Props) {
  return render(
    <ThemeProvider theme={theme}>
      <EnergyFlow
        solar={solar}
        grid={grid}
        battery={battery}
        home={home}
        batteryPct={50}
        batteryCount={5}
        connected
      />
    </ThemeProvider>,
  );
}

function routes(container: HTMLElement) {
  return {
    solarToBatt: container.querySelector("#pulse-solar-dst-batt") !== null,
    solarToHome: container.querySelector("#pulse-solar-dst-home") !== null,
    solarToGridExp:
      container.querySelector("#pulse-solar-dst-gridexp") !== null,
    gridToBatt: container.querySelector("#pulse-grid-dst-batt") !== null,
    gridToHome: container.querySelector("#pulse-grid-dst-home") !== null,
    battToHome: container.querySelector("#pulse-batt-dst-home") !== null,
    battToGridExp: container.querySelector("#pulse-batt-dst-gridexp") !== null,
  };
}

describe("EnergyFlow — home attribution waterfall", () => {
  it("solar fully consumed by battery charging feeds no flash to home; grid covers all of home (screenshot bug)", () => {
    const { container } = renderFlow({
      solar: 600,
      grid: 5000,
      battery: -600,
      home: 5100,
    });
    expect(routes(container)).toMatchObject({
      solarToBatt: true,
      solarToHome: false,
      gridToBatt: false,
      gridToHome: true,
    });
  });

  it("solar surplus beyond the battery's charge need splits to home, grid tops up the rest", () => {
    const { container } = renderFlow({
      solar: 1000,
      grid: 1600,
      battery: -600,
      home: 2000,
    });
    expect(routes(container)).toMatchObject({
      solarToBatt: true,
      solarToHome: true,
      gridToBatt: false,
      gridToHome: true,
    });
  });

  it("insufficient solar for the battery's charge need: grid fills the battery shortfall AND all of home", () => {
    const { container } = renderFlow({
      solar: 300,
      grid: 2300,
      battery: -600,
      home: 2000,
    });
    expect(routes(container)).toMatchObject({
      solarToBatt: true,
      solarToHome: false,
      gridToBatt: true,
      gridToHome: true,
    });
  });

  it("battery idle, solar surplus beyond home exports to grid", () => {
    const { container } = renderFlow({
      solar: 5000,
      grid: -3000,
      battery: 0,
      home: 2000,
    });
    expect(routes(container)).toMatchObject({
      solarToBatt: false,
      solarToHome: true,
      solarToGridExp: true,
    });
  });

  it("on-peak: solar, battery discharge, and grid import all feed home simultaneously", () => {
    const { container } = renderFlow({
      solar: 5000,
      grid: 1000,
      battery: 2000,
      home: 8000,
    });
    expect(routes(container)).toMatchObject({
      solarToBatt: false,
      solarToHome: true,
      battToHome: true,
      gridToHome: true,
    });
  });

  it("battery alone covers the solar/home gap: no grid flash needed", () => {
    const { container } = renderFlow({
      solar: 5000,
      grid: 0,
      battery: 3000,
      home: 8000,
    });
    expect(routes(container)).toMatchObject({
      solarToHome: true,
      battToHome: true,
      gridToHome: false,
    });
  });
});
