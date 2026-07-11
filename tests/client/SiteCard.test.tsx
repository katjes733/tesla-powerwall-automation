/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  within,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import SiteCard from "~/client/components/powerwall/SiteCard";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";
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

const SITE_INFO: SiteInfo = {
  id: "site-1",
  site_name: "Test Site",
  backup_reserve_percent: 20,
  default_real_mode: "autonomous",
  installation_date: "2025-12-30T00:00:00Z",
  user_settings: {} as SiteInfo["user_settings"],
  app_settings: {},
  components: { disallow_charge_from_grid_with_solar_installed: true },
  version: "26.18.1 fabf8f5a",
  battery_count: 5,
  tariff_content: {},
  nameplate_power: 23000,
  nameplate_energy: 40500,
  installation_time_zone: "America/Phoenix",
  off_grid_vehicle_charging_reserve_percent: 0,
  max_site_meter_power_ac: 0,
  min_site_meter_power_ac: 0,
  tariff_content_v2: {},
  vpp_backup_reserve_percent: 0,
  utility: "Salt River Project",
  island_config: {},
};

function renderCard(overrides: {
  smartCharging?: SmartChargingData | null;
  calibrating?: boolean;
  live?: LiveStatus | null;
  info?: SiteInfo | null;
}) {
  const live = "live" in overrides ? overrides.live! : LIVE;
  return render(
    <ThemeProvider theme={theme}>
      <SiteCard
        product={PRODUCT}
        live={live}
        info={overrides.info ?? null}
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

describe("SiteCard — collapsed site-details row", () => {
  it("renders no clickable row when info is null (nothing to show yet)", () => {
    renderCard({});
    expect(
      screen.queryByTestId("site-details-trigger"),
    ).not.toBeInTheDocument();
  });

  it("shows Mode/Backup reserve/Grid charging rows (not a generic 'Site details' label) instead of the always-visible Batteries/Firmware block", () => {
    renderCard({ info: SITE_INFO });
    const trigger = screen.getByTestId("site-details-trigger");
    expect(within(trigger).getByText("Self-Powered")).toBeInTheDocument();
    expect(within(trigger).getByText("20%")).toBeInTheDocument();
    expect(within(trigger).getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("Site details")).not.toBeInTheDocument();
    expect(screen.queryByText("Firmware")).not.toBeInTheDocument();
  });

  it("opens a dialog with the full site details on click", async () => {
    renderCard({ info: SITE_INFO });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("site-details-trigger"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("42")).toBeInTheDocument(); // Site ID
    expect(within(dialog).getByText("gw-1")).toBeInTheDocument(); // Gateway ID
    expect(within(dialog).getByText("26.18.1 fabf8f5a")).toBeInTheDocument();
    expect(within(dialog).getByText("Salt River Project")).toBeInTheDocument();
  });

  it("closes the dialog when Close is clicked", async () => {
    renderCard({ info: SITE_INFO });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("site-details-trigger"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
  });
});
