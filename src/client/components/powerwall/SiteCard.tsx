import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import HomeIcon from "@mui/icons-material/Home";
import PowerIcon from "@mui/icons-material/Power";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";

interface Props {
  product: Product;
  live: LiveStatus | null;
  info: SiteInfo | null;
}

function kw(watts: number): string {
  return `${(Math.abs(watts) / 1000).toFixed(2)} kW`;
}

function batteryColor(pct: number): "success" | "warning" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 20) return "warning";
  return "error";
}

function powerwallState(live: LiveStatus): string {
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

interface FlowCellProps {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  direction?: "in" | "out" | "none";
  color?: string;
}

function FlowCell({ icon, label, value, direction, color }: FlowCellProps) {
  const theme = useTheme();
  const dirSymbol = direction === "in" ? " ↓" : direction === "out" ? " ↑" : "";
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
        p: 1,
        borderRadius: 1,
        bgcolor: theme.palette.action.hover,
        minWidth: 100,
        flex: 1,
      }}
    >
      <Box sx={{ color: color ?? "text.secondary" }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value !== null ? (
          <>
            {value}
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
            >
              {dirSymbol}
            </Typography>
          </>
        ) : (
          "–"
        )}
      </Typography>
    </Box>
  );
}

export default function SiteCard({ product, live, info }: Props) {
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

  const solarFlow = live
    ? { value: kw(live.solar_power), dir: "out" as const }
    : null;
  const gridFlow = live
    ? {
        value: kw(live.grid_power),
        dir: live.grid_power >= 0 ? ("in" as const) : ("out" as const),
      }
    : null;
  const batteryFlow = live
    ? {
        value: kw(live.battery_power),
        dir:
          live.battery_power > 100
            ? ("in" as const)
            : live.battery_power < -100
              ? ("out" as const)
              : ("none" as const),
      }
    : null;
  const homeFlow = live
    ? { value: kw(live.load_power), dir: "none" as const }
    : null;

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
          <Chip
            label={gridChipLabel}
            color={gridChipColor}
            size="small"
            sx={{ mt: 1, mr: 1 }}
          />
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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {isConnected && live ? powerwallState(live) : "No live data"}
          </Typography>
        </Box>

        {/* Power flows */}
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <FlowCell
            icon={<WbSunnyIcon />}
            label="Solar"
            value={solarFlow?.value ?? null}
            direction={solarFlow?.dir}
            color="#f59e0b"
          />
          <FlowCell
            icon={<PowerIcon />}
            label="Grid"
            value={gridFlow?.value ?? null}
            direction={gridFlow?.dir}
            color={theme.palette.secondary.main}
          />
        </Box>
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <FlowCell
            icon={<HomeIcon />}
            label="Home"
            value={homeFlow?.value ?? null}
            direction={homeFlow?.dir}
            color={theme.palette.text.secondary}
          />
          <FlowCell
            icon={<BatteryChargingFullIcon />}
            label="Battery"
            value={batteryFlow?.value ?? null}
            direction={batteryFlow?.dir}
            color={theme.palette.primary.main}
          />
        </Box>

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
