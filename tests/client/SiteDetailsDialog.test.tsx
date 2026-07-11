/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import SiteDetailsDialog from "~/client/components/powerwall/SiteDetailsDialog";
import type { Product, SiteInfo } from "~/server/types/common";

const theme = createTheme();

const PRODUCT: Product = {
  id: "prod-1",
  site_name: "Test Site",
  device_type: "energy",
  energy_site_id: 42,
  gateway_id: "gw-1",
};

const SITE_INFO: SiteInfo = {
  id: "site-1",
  site_name: "Test Site",
  backup_reserve_percent: 20,
  default_real_mode: "self_consumption",
  installation_date: "2025-12-30T00:00:00Z",
  user_settings: {} as SiteInfo["user_settings"],
  app_settings: {},
  components: { disallow_charge_from_grid_with_solar_installed: false },
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

function renderDialog(info: SiteInfo | null, onClose = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <SiteDetailsDialog open onClose={onClose} product={PRODUCT} info={info} />
    </ThemeProvider>,
  );
}

describe("SiteDetailsDialog", () => {
  it("always shows the Site ID and Gateway ID, even without info", () => {
    renderDialog(null);
    expect(screen.getByText("Site ID")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Gateway ID")).toBeInTheDocument();
    expect(screen.getByText("gw-1")).toBeInTheDocument();
    expect(screen.queryByText("Mode")).not.toBeInTheDocument();
  });

  it("omits Mode/Backup reserve/Grid charging — already shown on the card's collapsed row", () => {
    renderDialog(SITE_INFO);
    expect(screen.queryByText("Mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Backup reserve")).not.toBeInTheDocument();
    expect(screen.queryByText("Grid charging")).not.toBeInTheDocument();
  });

  it("shows all the extended fields when present", () => {
    renderDialog(SITE_INFO);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Timezone")).toBeInTheDocument();
    expect(screen.getByText("America/Phoenix")).toBeInTheDocument();
    expect(screen.getByText("Utility")).toBeInTheDocument();
    expect(screen.getByText("Salt River Project")).toBeInTheDocument();
    expect(screen.getByText("Nameplate power")).toBeInTheDocument();
    expect(screen.getByText("23.0 kW")).toBeInTheDocument();
    expect(screen.getByText("Nameplate energy")).toBeInTheDocument();
    expect(screen.getByText("40.5 kWh")).toBeInTheDocument();
  });

  it("omits the gateway row entirely when the product has no gateway_id", () => {
    render(
      <ThemeProvider theme={theme}>
        <SiteDetailsDialog
          open
          onClose={vi.fn()}
          product={{ ...PRODUCT, gateway_id: "" }}
          info={null}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByText("Gateway ID")).not.toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = vi.fn();
    renderDialog(SITE_INFO, onClose);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
