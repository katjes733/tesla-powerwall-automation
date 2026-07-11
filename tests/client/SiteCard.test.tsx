/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import SiteCard from "~/client/components/powerwall/SiteCard";
import type { LiveStatus, Product } from "~/server/types/common";
import type { SmartChargingData } from "~/server/util/fleet";

const theme = createTheme();

const PRODUCT: Product = {
  id: "prod-1",
  site_name: "Test Site",
  device_type: "energy",
  energy_site_id: 42,
  gateway_id: "gw-1",
};

const LIVE: LiveStatus = {
  solar_power: 1000,
  percentage_charged: 61,
  battery_power: 500,
  load_power: 2000,
  grid_status: "Active",
  grid_power: 0,
  generation_power: 1000,
  wall_connectors: {},
  island_status: "on_grid",
  storm_mode_active: false,
};

const SMART_CHARGING_BASE: SmartChargingData = {
  desired: "disabled",
  current: "disabled",
  action: "no_change",
  soc: 61,
  targetSoc: 100,
  forecastMethod: "linear-fallback",
  estimatedSolarKwh: null,
  weatherFactor: null,
  batteryChargeRateFromGridKw: null,
  liveKw: { solar: 1, load: 2, grid: 0, battery: 0.5 },
  chargeRateKw: 5,
  chargeRateSource: "formula",
  chargeRateCurveSource: "defaults",
  reason: "test fixture",
  situation: "in_peak",
  gridEnergyKwh: null,
  solarCoversAboveSocPct: null,
  peakOrDeadlineAt: null,
  predictedSocAtPeak: 61,
  targetGapPct: 39,
  gridStartAt: null,
  windowReopensAt: null,
  solarContributionPct: null,
  gridContributionPct: null,
};

function renderCard(overrides: {
  smartCharging?: SmartChargingData | null;
  calibrating?: boolean;
  live?: LiveStatus | null;
}) {
  const live = "live" in overrides ? overrides.live! : LIVE;
  return render(
    <ThemeProvider theme={theme}>
      <SiteCard
        product={PRODUCT}
        live={live}
        info={null}
        calibrating={overrides.calibrating ?? false}
        smartCharging={overrides.smartCharging ?? null}
      />
    </ThemeProvider>,
  );
}

describe("SiteCard — predicted-charge gauge gating", () => {
  it("renders no predicted-charge gauge when smartCharging is null", () => {
    const { getByTestId, queryByTestId } = renderCard({ smartCharging: null });
    expect(queryByTestId("predicted-charge-gauge")).not.toBeInTheDocument();
    expect(getByTestId("soc-gauge-group").children).toHaveLength(1);
  });

  it("renders the predicted-charge gauge (paused mode) when smartCharging exists but on-peak — must not look identical to no schedule", () => {
    const { getByTestId } = renderCard({
      smartCharging: { ...SMART_CHARGING_BASE, situation: "in_peak" },
    });
    expect(getByTestId("predicted-charge-gauge")).toBeInTheDocument();
    expect(getByTestId("soc-gauge-group").children).toHaveLength(2);
    expect(screen.getByText("On-Peak")).toBeInTheDocument();
  });

  it("renders the predicted-charge gauge in rich-forecast mode when waiting", () => {
    const { getByTestId } = renderCard({
      smartCharging: {
        ...SMART_CHARGING_BASE,
        situation: "waiting",
        peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
        gridStartAt: "2026-07-13T19:30:00.000Z",
        predictedSocAtPeak: 92,
        targetGapPct: 8,
      },
    });
    expect(getByTestId("predicted-charge-gauge")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
  });
});

describe("SiteCard — state pill (unchanged behavior)", () => {
  it("shows Calibrating when calibrating is true", () => {
    renderCard({ calibrating: true });
    expect(screen.getByText("Calibrating")).toBeInTheDocument();
  });

  it("shows No Data when live is null", () => {
    renderCard({ live: null });
    expect(screen.getByText("No Data")).toBeInTheDocument();
  });

  it("shows Discharging when battery_power is well above zero", () => {
    renderCard({ live: { ...LIVE, battery_power: 500 } });
    expect(screen.getByText("Discharging")).toBeInTheDocument();
  });

  it("shows Charging when battery_power is well below zero", () => {
    renderCard({ live: { ...LIVE, battery_power: -500 } });
    expect(screen.getByText("Charging")).toBeInTheDocument();
  });

  it("shows Full when percentage_charged is 100", () => {
    renderCard({
      live: { ...LIVE, battery_power: 0, percentage_charged: 100 },
    });
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("shows Standby when idle and not full", () => {
    renderCard({
      live: { ...LIVE, battery_power: 0, percentage_charged: 61 },
    });
    expect(screen.getByText("Standby")).toBeInTheDocument();
  });

  it("shows Smart Charging when the schedule is actively grid-charging", () => {
    renderCard({
      live: { ...LIVE, battery_power: -500 },
      smartCharging: { ...SMART_CHARGING_BASE, situation: "grid_needed" },
    });
    expect(screen.getByText("Smart Charging")).toBeInTheDocument();
  });
});
