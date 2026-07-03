import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";
import EnergyFlow from "./EnergyFlow";

interface Props {
  product: Product;
  live: LiveStatus | null;
  info: SiteInfo | null;
  calibrating?: boolean;
  activeHoliday?: string | null;
}

function batteryColor(pct: number): "success" | "warning" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 20) return "warning";
  return "error";
}

function powerwallState(live: LiveStatus, calibrating: boolean): string {
  if (calibrating) return "Calibrating";
  if (live.battery_power > 100) return "Discharging";
  if (live.battery_power < -100) return "Charging";
  if (live.percentage_charged >= 100) return "Full";
  return "Standby";
}

function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    autonomous: "Self-Powered",
    backup: "Backup Only",
    self_consumption: "Self-Consumption",
  };
  return map[mode] ?? mode;
}

export default function SiteCard({
  product,
  live,
  info,
  calibrating = false,
  activeHoliday = null,
}: Props) {
  const theme = useTheme();

  const isOnGrid =
    live?.grid_status?.toLowerCase() === "active" &&
    live?.island_status === "on_grid";
  const isConnected = live !== null;

  const gridChipColor = !isConnected
    ? "default"
    : isOnGrid
      ? "success"
      : "error";
  const gridChipLabel = !isConnected
    ? "Offline"
    : isOnGrid
      ? "On Grid"
      : "Off Grid";

  const soc = live?.percentage_charged ?? 0;
  const socColor = isConnected ? batteryColor(soc) : "inherit";

  return (
    <Card
      elevation={3}
      sx={{ minWidth: 300, maxWidth: 420, flex: 1, borderRadius: 2 }}
    >
      <CardHeader
        title={
          info?.site_name ??
          product.site_name ??
          `Site ${product.energy_site_id}`
        }
        titleTypographyProps={{ variant: "h6", fontWeight: 600 }}
        subheader={`ID: ${product.energy_site_id}`}
        action={
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 0.5,
              mt: 1,
              mr: 1,
            }}
          >
            <Chip label={gridChipLabel} color={gridChipColor} size="small" />
            {activeHoliday && (
              <Chip
                label={`Holiday: ${activeHoliday}`}
                color="warning"
                size="small"
              />
            )}
          </Box>
        }
      />

      <CardContent>
        {/* Battery SOC */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 2,
          }}
        >
          <Box sx={{ position: "relative", display: "inline-flex" }}>
            <CircularProgress
              variant="determinate"
              value={isConnected ? soc : 0}
              size={120}
              thickness={6}
              color={socColor === "inherit" ? "inherit" : socColor}
              sx={{
                color: !isConnected ? theme.palette.action.disabled : undefined,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="h4"
                fontWeight={700}
                color={!isConnected ? "text.disabled" : undefined}
              >
                {isConnected ? `${Math.round(soc)}%` : "–"}
              </Typography>
            </Box>
          </Box>
          {calibrating ? (
            <Chip
              label="Calibrating"
              color="warning"
              size="small"
              sx={{ mt: 1 }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {isConnected && live
                ? powerwallState(live, calibrating)
                : "No live data"}
            </Typography>
          )}
        </Box>

        {/* Energy flow diagram */}
        <EnergyFlow
          solar={live?.solar_power ?? 0}
          grid={live?.grid_power ?? 0}
          battery={live?.battery_power ?? 0}
          home={live?.load_power ?? 0}
          batteryPct={live?.percentage_charged ?? 0}
          batteryCount={info?.battery_count ?? 0}
          connected={isConnected}
        />

        {info && (
          <>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Mode
                </Typography>
                <Typography variant="body2">
                  {modeLabel(info.default_real_mode)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Backup reserve
                </Typography>
                <Typography variant="body2">
                  {info.backup_reserve_percent}%
                </Typography>
              </Box>
              {info.components
                ?.disallow_charge_from_grid_with_solar_installed !==
                undefined && (
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Grid charging
                  </Typography>
                  <Typography variant="body2">
                    {info.components
                      .disallow_charge_from_grid_with_solar_installed
                      ? "Disabled"
                      : "Enabled"}
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Batteries
                </Typography>
                <Typography variant="body2">{info.battery_count}</Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Firmware
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
                >
                  {info.version}
                </Typography>
              </Box>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
