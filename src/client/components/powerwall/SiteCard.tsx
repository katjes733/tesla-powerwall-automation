import { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip, { type ChipProps } from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";
import type { SmartChargingData } from "~/server/util/fleet";
import EnergyFlow from "./EnergyFlow";
import SiteDetailsDialog, { modeLabel } from "./SiteDetailsDialog";

// Toggle to compare the two SOC layouts for sites with smart charging
// enabled: a horizontal progress bar (true) vs. the original circular gauge
// side-by-side with the smart-charging ring (false). Flip and reload to
// switch — purely a development-time A/B comparison, not a runtime setting.
const USE_HORIZONTAL_SOC_BAR = true;

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

// Shared by both smart-charging visualizations (the circular gauge and its
// horizontal-bar alternative): solarContributionPct/gridContributionPct are
// computed server-side as a share of total battery capacity, not of the
// remaining need — so a large solar forecast against a small deficit can
// legitimately read e.g. 147%. Clamp to the gauge's actual remaining room
// (100 - soc) so neither visualization can overshoot its own 0-100 scale,
// and the printed numbers always match what's drawn.
function computeChargeBreakdown(data: SmartChargingData, timezone?: string) {
  const isRich = data.peakOrDeadlineAt !== null;
  const predicted = data.predictedSocAtPeak ?? data.soc;
  const availableRoomPct = Math.max(0, 100 - data.soc);
  const solarPct = Math.min(data.solarContributionPct ?? 0, availableRoomPct);
  const gridPct = Math.min(
    data.gridContributionPct ?? 0,
    Math.max(0, availableRoomPct - solarPct),
  );
  const caption = isRich ? smartChargingCaption(data, timezone) : null;
  const solarPart = solarPct > 0 ? `☀ ${solarPct.toFixed(0)}%` : null;
  const gridPart = gridPct > 0 ? `⚡ ${gridPct.toFixed(0)}%` : null;
  const contributionLine = isRich
    ? [solarPart, gridPart].filter(Boolean).join("  ") || null
    : null;
  return { isRich, predicted, solarPct, gridPct, caption, contributionLine };
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
  const isShortfall = data.targetGapPct > 2;
  const { isRich, predicted, solarPct, gridPct, caption, contributionLine } =
    computeChargeBreakdown(data, timezone);

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
        <ChargeCaptionLines
          caption={caption}
          contributionLine={contributionLine}
        />
      )}
    </Box>
  );
}

// The situation caption ("Starts Today, 6:00 PM" / "Solar only — no grid
// needed" / ...) and the solar/grid contribution breakdown, stacked below
// either smart-charging visualization — factored out since both the
// circular gauge and its horizontal-bar alternative render it identically.
function ChargeCaptionLines({
  caption,
  contributionLine,
  align = "center",
}: {
  caption: string | null;
  contributionLine: string | null;
  align?: "center" | "left";
}) {
  return (
    <Box sx={{ mt: 0.5 }}>
      {caption && (
        <Typography
          variant="caption"
          color="text.secondary"
          align={align}
          sx={{ lineHeight: 1.2, display: "block" }}
        >
          {caption}
        </Typography>
      )}
      {contributionLine && (
        <Typography
          variant="caption"
          color="text.secondary"
          align={align}
          sx={{ lineHeight: 1.2, display: "block" }}
        >
          {contributionLine}
        </Typography>
      )}
    </Box>
  );
}

// Horizontal alternative to the circular SOC gauge, used only when smart
// charging is enabled (see USE_HORIZONTAL_SOC_BAR) — the percentage and the
// site's current state label both render inside the bar itself, so this row
// carries the same information as the circle + pill it replaces in far less
// vertical space, leaving room below for the smart-charging bar and its
// caption text.
function SocBar({
  pct,
  connected,
  label,
  color,
}: {
  pct: number;
  connected: boolean;
  label: string;
  color: ChipProps["color"];
}) {
  const theme = useTheme();
  const barColor =
    !connected || !color || color === "default"
      ? theme.palette.grey[500]
      : theme.palette[color].main;

  return (
    <Box sx={{ width: "100%" }}>
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ display: "block", mb: 0.25 }}
      >
        Battery
      </Typography>
      <Box sx={{ position: "relative", width: "100%" }}>
        <LinearProgress
          variant="determinate"
          value={connected ? pct : 0}
          sx={{
            height: 26,
            borderRadius: 1.5,
            backgroundColor: theme.palette.action.disabledBackground,
            "& .MuiLinearProgress-bar": {
              borderRadius: 1.5,
              backgroundColor: connected
                ? barColor
                : theme.palette.action.disabled,
            },
          }}
        />
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.25,
          }}
        >
          <Typography
            variant="body2"
            fontWeight={700}
            sx={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
          >
            {connected ? `${Math.round(pct)}%` : "–"}
          </Typography>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
          >
            {label}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// Horizontal alternative to the circular smart-charging gauge (see
// USE_HORIZONTAL_SOC_BAR). A bar has no fixed-size interior to cram forecast
// text into, so the caption and contribution breakdown render in the normal
// document flow below it — as much room as they need, instead of being
// squeezed inside a ~100px circle.
export function SmartChargingBar({
  data,
  timezone,
  height = 26,
}: {
  data: SmartChargingData;
  timezone?: string;
  height?: number;
}) {
  const theme = useTheme();
  const isShortfall = data.targetGapPct > 2;
  const { isRich, predicted, solarPct, gridPct, caption } =
    computeChargeBreakdown(data, timezone);
  const targetPct = Math.min(100, data.targetSoc);

  return (
    <Box
      data-testid="predicted-charge-gauge"
      data-shortfall={String(isShortfall)}
      sx={{ width: "100%" }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ display: "block", mb: 0.25 }}
      >
        Charge Forecast
      </Typography>
      {/* Outer wrapper is NOT clipped (unlike the rounded bar itself just
          below), so the target tick can visibly protrude above/below the
          bar as a real marker instead of being flush-clipped into an
          easy-to-miss sliver. The tick is placed BEFORE the bar in DOM
          order (not after) so the bar — and critically its predicted/target
          text overlay — always paints on top wherever they'd otherwise
          overlap (e.g. target=100% puts the tick right under "target 100%").
          Only the tick's protruding ends above/below the bar, where nothing
          from the bar paints, stay visible — which is exactly the marker
          effect intended. */}
      <Box sx={{ position: "relative", width: "100%" }}>
        {isRich && (
          <Box
            data-testid="target-bar-tick"
            sx={{
              position: "absolute",
              width: 3,
              top: -6,
              bottom: -6,
              borderRadius: 0.5,
            }}
            style={{
              left: `${targetPct}%`,
              marginLeft: -1.5,
              backgroundColor: isShortfall
                ? theme.palette.warning.main
                : theme.palette.text.primary,
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: -4,
                left: "50%",
                width: 0,
                height: 0,
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                transform: "translateX(-50%)",
              }}
              style={{
                borderTop: `5px solid ${isShortfall ? theme.palette.warning.main : theme.palette.text.primary}`,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                top: -16,
                left: "50%",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                color: "text.secondary",
                fontSize: 9,
              }}
            >
              {data.targetSoc}%
            </Typography>
          </Box>
        )}
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height,
            borderRadius: 1.5,
            backgroundColor: theme.palette.action.disabledBackground,
            overflow: "hidden",
          }}
        >
          <Box
            data-testid="soc-bar-segment"
            sx={{ position: "absolute", top: 0, bottom: 0 }}
            style={{
              left: 0,
              width: `${data.soc}%`,
              backgroundColor: theme.palette.grey[400],
            }}
          />
          {isRich && (
            <>
              <Box
                data-testid="solar-bar-segment"
                sx={{ position: "absolute", top: 0, bottom: 0 }}
                style={{
                  left: `${data.soc}%`,
                  width: `${solarPct}%`,
                  backgroundColor: "#f59e0b",
                }}
              />
              <Box
                data-testid="grid-bar-segment"
                sx={{ position: "absolute", top: 0, bottom: 0 }}
                style={{
                  left: `${data.soc + solarPct}%`,
                  width: `${gridPct}%`,
                  backgroundColor: theme.palette.secondary.main,
                }}
              />
            </>
          )}
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: isRich ? "space-between" : "center",
              px: 1.25,
            }}
          >
            {isRich ? (
              <>
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{
                    color: "#fff",
                    textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                  }}
                >
                  {Math.round(predicted)}%
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  sx={{
                    color: "#fff",
                    textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                  }}
                >
                  target {data.targetSoc}%
                </Typography>
              </>
            ) : (
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
              >
                {PAUSED_LABEL[data.situation] ?? ""}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      {isRich && (solarPct > 0 || gridPct > 0) && (
        <Box sx={{ position: "relative", width: "100%", height: 14, mt: 0.25 }}>
          {solarPct > 0 && (
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                top: 0,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                color: "text.secondary",
                fontSize: 10,
              }}
              style={{ left: `${data.soc + solarPct / 2}%` }}
            >
              ☀ {solarPct.toFixed(0)}%
            </Typography>
          )}
          {gridPct > 0 && (
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                top: 0,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                color: "text.secondary",
                fontSize: 10,
              }}
              style={{ left: `${data.soc + solarPct + gridPct / 2}%` }}
            >
              ⚡ {gridPct.toFixed(0)}%
            </Typography>
          )}
        </Box>
      )}
      {isRich && caption && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.25, lineHeight: 1.2 }}
        >
          {caption}
        </Typography>
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
        sx={{ pt: 1, pb: 0.5 }}
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

      <CardContent sx={{ pt: 1, pb: 1.5, "&:last-child": { pb: 1.5 } }}>
        {/* Battery SOC (+ predicted-charge gauge, when a smart schedule exists) */}
        {smartCharging && USE_HORIZONTAL_SOC_BAR ? (
          <Box
            data-testid="soc-gauge-group"
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              mb: { xs: 2.5, sm: 3 },
            }}
          >
            <SocBar
              pct={soc}
              connected={isConnected}
              label={stateChip.label}
              color={stateChip.color}
            />
            <SmartChargingBar
              data={smartCharging}
              timezone={info?.installation_time_zone}
            />
          </Box>
        ) : (
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
        )}

        {/* Energy flow diagram — given more room now that the Mode/Backup
            reserve/Firmware block below collapses into a single clickable
            row instead of always occupying its own space. */}
        <EnergyFlow
          solar={live?.solar_power ?? 0}
          grid={live?.grid_power ?? 0}
          battery={live?.battery_power ?? 0}
          home={live?.load_power ?? 0}
          batteryPct={live?.percentage_charged ?? 0}
          batteryCount={info?.battery_count ?? 0}
          connected={isConnected}
          maxHeight={isMobile ? 300 : 400}
        />

        {info && (
          <>
            <Divider sx={{ mt: 1.5, mb: 0.5 }} />
            <ButtonBase
              data-testid="site-details-trigger"
              onClick={() => setDetailsOpen(true)}
              sx={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 0.5,
                py: 0.75,
                borderRadius: 1,
                textAlign: "left",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  flex: 1,
                  minWidth: 0,
                }}
              >
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
                  <Box
                    sx={{ display: "flex", justifyContent: "space-between" }}
                  >
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
              </Box>
              <ChevronRightIcon
                fontSize="small"
                sx={{ color: "text.secondary", flexShrink: 0 }}
              />
            </ButtonBase>
          </>
        )}
      </CardContent>

      <SiteDetailsDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        product={product}
        info={info}
      />
    </Card>
  );
}
