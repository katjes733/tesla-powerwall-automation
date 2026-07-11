import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip, { type ChipProps } from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";
import type { SmartChargingData } from "~/server/util/fleet";
import EnergyFlow from "./EnergyFlow";

interface Props {
  product: Product;
  live: LiveStatus | null;
  info: SiteInfo | null;
  calibrating?: boolean;
  activeHoliday?: string | null;
  smartCharging?: SmartChargingData | null;
}

function batteryColor(pct: number): "success" | "warning" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 20) return "warning";
  return "error";
}

// Every current-state indicator is a colored chip — priority-ordered so
// exactly one, most-relevant state shows at a time.
function siteStateChip(
  live: LiveStatus | null,
  calibrating: boolean,
  smartChargingActive: boolean,
): { label: string; color: ChipProps["color"] } {
  if (!live) return { label: "No Data", color: "default" };
  if (calibrating) return { label: "Calibrating", color: "warning" };
  if (smartChargingActive) return { label: "Smart Charging", color: "info" };
  if (live.battery_power > 100)
    return { label: "Discharging", color: "secondary" };
  if (live.battery_power < -100) return { label: "Charging", color: "success" };
  if (live.percentage_charged >= 100)
    return { label: "Full", color: "success" };
  return { label: "Standby", color: "default" };
}

function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    autonomous: "Self-Powered",
    backup: "Backup Only",
    self_consumption: "Self-Consumption",
  };
  return map[mode] ?? mode;
}

function localDateParts(
  date: Date,
  timeZone?: string,
): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone && { timeZone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// "Today, 6:00 PM" / "Tomorrow, 6:00 AM" / "Monday, 7:30 PM" — day-qualified
// so a time never reads as "tonight" when it's actually days out (e.g. the
// next on-peak period skipping a no-peak weekend, landing on Monday).
// Locale-aware time formatting (respects the viewer's own 12h/24h
// convention) computed in the site's own timezone, not the browser's.
export function formatDayTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const target = localDateParts(date, timeZone);
  const today = localDateParts(new Date(), timeZone);
  const dayDiff = Math.round(
    (Date.UTC(target.y, target.m - 1, target.d) -
      Date.UTC(today.y, today.m - 1, today.d)) /
      86_400_000,
  );
  const time = new Intl.DateTimeFormat(undefined, {
    ...(timeZone && { timeZone }),
    timeStyle: "short",
  }).format(date);
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  const weekday = new Intl.DateTimeFormat(undefined, {
    ...(timeZone && { timeZone }),
    weekday: "long",
  }).format(date);
  return `${weekday}, ${time}`;
}

const PAUSED_LABEL: Record<string, string> = {
  in_peak: "On-Peak",
  deadline_passed: "Past Deadline",
  target_reached: "At Target",
  no_peak_found: "No Peak",
};

function smartChargingCaption(
  data: SmartChargingData,
  timezone?: string,
): string | null {
  switch (data.situation) {
    case "grid_needed":
      return "Charging now";
    case "waiting":
      return data.gridStartAt
        ? `Starts ${formatDayTime(data.gridStartAt, timezone)}`
        : null;
    case "blocked_window":
      return data.windowReopensAt
        ? `Resumes ${formatDayTime(data.windowReopensAt, timezone)}`
        : null;
    case "solar_sufficient":
      return "Solar only — no grid needed";
    default:
      return null;
  }
}

// Its presence (not its content) is the signal for "is smart charging
// configured for this site at all" — the caller only renders this when
// `smartCharging` isn't null. What varies internally is rich-forecast mode
// (a real upcoming peak/deadline to plan against) vs. simple/paused mode
// (on-peak / past deadline / target already met / no peak found) — the
// latter still renders a ring so it never looks identical to "no smart
// schedule configured," it just can't make a forecast claim right now.
export function PredictedChargeGauge({
  data,
  timezone,
  size,
}: {
  data: SmartChargingData;
  timezone?: string;
  size: number;
}) {
  const theme = useTheme();
  const isRich = data.peakOrDeadlineAt !== null;
  const isShortfall = data.targetGapPct > 2;

  // MUI's CircularProgress (the main SOC gauge) renders `thickness` as an SVG
  // stroke-width inside a fixed 44-unit viewBox, then scales that whole
  // viewBox up to `size` px — so its *real* rendered thickness is
  // `thickness * (size / 44)`, not the literal thickness value. This gauge
  // draws directly in real pixels (no viewBox rescaling), so it must apply
  // the same scaling itself to render the same visual thickness as the ring
  // it sits beside — matching `thickness={6}` on the main gauge.
  const strokeWidth = (6 * size) / 44;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  const arcProps = (startPct: number, lengthPct: number) => ({
    strokeDasharray: `${(lengthPct / 100) * circumference} ${circumference}`,
    strokeDashoffset: -((startPct / 100) * circumference),
  });

  const predicted = data.predictedSocAtPeak ?? data.soc;
  // solarContributionPct/gridContributionPct are computed server-side as a
  // share of total battery capacity, not of the remaining need — so a large
  // solar forecast against a small deficit can legitimately read e.g. 147%.
  // Clamp to the ring's actual remaining room (100 - soc) so the arc can
  // never overshoot the 0-100 scale and the printed number always matches
  // what's drawn, instead of contradicting an already-capped 100% center
  // reading with an uncapped, confusing percentage below it.
  const availableRoomPct = Math.max(0, 100 - data.soc);
  const solarPct = Math.min(data.solarContributionPct ?? 0, availableRoomPct);
  const gridPct = Math.min(
    data.gridContributionPct ?? 0,
    Math.max(0, availableRoomPct - solarPct),
  );

  const targetAngleRad =
    ((Math.min(100, data.targetSoc) / 100) * 360 - 90) * (Math.PI / 180);
  const tickInner = {
    x: cx + (r - strokeWidth / 2 - 2) * Math.cos(targetAngleRad),
    y: cy + (r - strokeWidth / 2 - 2) * Math.sin(targetAngleRad),
  };
  const tickOuter = {
    x: cx + (r + strokeWidth / 2 + 2) * Math.cos(targetAngleRad),
    y: cy + (r + strokeWidth / 2 + 2) * Math.sin(targetAngleRad),
  };

  const caption = isRich ? smartChargingCaption(data, timezone) : null;
  const solarPart = solarPct > 0 ? `☀ ${solarPct.toFixed(0)}%` : null;
  const gridPart = gridPct > 0 ? `⚡ ${gridPct.toFixed(0)}%` : null;
  const contributionLine = isRich
    ? [solarPart, gridPart].filter(Boolean).join("  ") || null
    : null;

  return (
    <Box
      data-testid="predicted-charge-gauge"
      data-shortfall={String(isShortfall)}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        maxWidth: 140,
        minWidth: 0,
      }}
    >
      <Box sx={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block" }}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={theme.palette.action.disabledBackground}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={theme.palette.grey[400]}
            strokeWidth={strokeWidth}
            transform={`rotate(-90 ${cx} ${cy})`}
            {...arcProps(0, data.soc)}
          />
          {isRich && (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={strokeWidth}
                transform={`rotate(-90 ${cx} ${cy})`}
                {...arcProps(data.soc, solarPct)}
              />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={theme.palette.secondary.main}
                strokeWidth={strokeWidth}
                transform={`rotate(-90 ${cx} ${cy})`}
                {...arcProps(data.soc + solarPct, gridPct)}
              />
              <line
                x1={tickInner.x}
                y1={tickInner.y}
                x2={tickOuter.x}
                y2={tickOuter.y}
                stroke={theme.palette.text.primary}
                strokeWidth={2}
              />
            </>
          )}
        </svg>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isRich ? (
            <>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: 9, lineHeight: 1.2 }}
              >
                Predicted
              </Typography>
              <Typography
                variant={size >= 120 ? "h5" : "h6"}
                fontWeight={700}
                color={isShortfall ? "warning.main" : "success.main"}
              >
                {Math.round(predicted)}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                target {data.targetSoc}%
              </Typography>
            </>
          ) : (
            <Typography
              variant="body2"
              fontWeight={600}
              color="text.secondary"
              align="center"
              sx={{ px: 1 }}
            >
              {PAUSED_LABEL[data.situation] ?? ""}
            </Typography>
          )}
        </Box>
      </Box>
      {isRich && (caption || contributionLine) && (
        <Box sx={{ mt: 0.5 }}>
          {caption && (
            <Typography
              variant="caption"
              color="text.secondary"
              align="center"
              sx={{ lineHeight: 1.2, display: "block" }}
            >
              {caption}
            </Typography>
          )}
          {contributionLine && (
            <Typography
              variant="caption"
              color="text.secondary"
              align="center"
              sx={{ lineHeight: 1.2, display: "block" }}
            >
              {contributionLine}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

export default function SiteCard({
  product,
  live,
  info,
  calibrating = false,
  activeHoliday = null,
  smartCharging = null,
}: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const isOnGrid =
    live?.grid_status?.toLowerCase() === "active" &&
    live?.island_status === "on_grid";
  const isConnected = live !== null;
  const smartChargingActive = smartCharging?.situation === "grid_needed";
  const stateChip = siteStateChip(live, calibrating, smartChargingActive);

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
      sx={{
        minWidth: { xs: 260, sm: 300 },
        maxWidth: 420,
        flex: 1,
        borderRadius: 2,
      }}
    >
      <CardHeader
        title={
          info?.site_name ??
          product.site_name ??
          `Site ${product.energy_site_id}`
        }
        titleTypographyProps={{ variant: "h6", fontWeight: 600 }}
        subheader={isMobile ? undefined : `ID: ${product.energy_site_id}`}
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
        {/* Battery SOC (+ predicted-charge gauge, when a smart schedule exists) */}
        <Box
          data-testid="soc-gauge-group"
          sx={{
            display: "flex",
            flexDirection: "row",
            // flex-start (not center): the two columns have different total
            // heights depending on mode (pill vs. no caption in paused mode,
            // caption + contribution lines in rich mode) — top-aligning keeps
            // the circles themselves level regardless of what renders below.
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 2,
            mb: { xs: 1, sm: 2 },
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Box sx={{ position: "relative", display: "inline-flex" }}>
              <CircularProgress
                variant="determinate"
                value={isConnected ? soc : 0}
                size={isMobile ? 88 : 120}
                thickness={6}
                color={socColor === "inherit" ? "inherit" : socColor}
                sx={{
                  color: !isConnected
                    ? theme.palette.action.disabled
                    : undefined,
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
                  variant={isMobile ? "h5" : "h4"}
                  fontWeight={700}
                  color={!isConnected ? "text.disabled" : undefined}
                >
                  {isConnected ? `${Math.round(soc)}%` : "–"}
                </Typography>
              </Box>
            </Box>
            <Chip
              label={stateChip.label}
              color={stateChip.color}
              size="small"
              sx={{ mt: 1 }}
            />
          </Box>
          {smartCharging && (
            <PredictedChargeGauge
              data={smartCharging}
              timezone={info?.installation_time_zone}
              size={isMobile ? 88 : 120}
            />
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
          maxHeight={isMobile ? 240 : 320}
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
