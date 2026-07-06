import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useTheme, type Theme } from "@mui/material/styles";
import { useMemo, useCallback, useState } from "react";

export interface ChartSeriesConfig {
  dataKey: string;
  label: string;
  color: string;
  negativeColor?: string; // when set, splits the series at y=0 into two independently colored areas
  positiveLabel?: string; // text shown in the positive (above-zero) region
  negativeLabel?: string; // text shown in the negative (below-zero) region
  type?: "area" | "line";
}

export interface EnergyChartProps {
  data: Record<string, number | null>[];
  series: ChartSeriesConfig[];
  height?: number;
  unit?: string;
  showZeroLine?: boolean;
  timezone?: string;
}

function formatTimeInZone(epochMs: number, timezone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(epochMs));
}

function niceTickInterval(dataMin: number, dataMax: number): number {
  const range = Math.max(Math.abs(dataMax - dataMin), 1);
  const rough = range / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  const niceFrac = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return niceFrac * Math.pow(10, exp);
}

function gradId(label: string, suffix = ""): string {
  return `rcg-${label.replace(/[^a-zA-Z0-9]/g, "-")}${suffix}`;
}

interface TooltipItem {
  dataKey?: string | number | ((obj: unknown) => unknown);
  name?: string | number; // Recharts NameType = string | number
  value?: number | null;
  color?: string;
  stroke?: string;
  fill?: string;
}

interface EnergyTooltipProps {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: number | string; // Recharts LabelType = string | number
  theme: Theme;
  timezone?: string;
  unit: string;
}

function EnergyTooltip({
  active,
  payload,
  label,
  theme,
  timezone,
  unit,
}: EnergyTooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const time = formatTimeInZone(Number(label), timezone);

  const seen = new Set<string>();
  const rows = [...payload]
    .filter((p) => {
      if (p.value == null) return false;
      const key = typeof p.dataKey === "string" ? p.dataKey : "";
      // Skip the zero-value half of a mirror pair (the active half is always non-zero).
      if (p.value === 0 && (key.endsWith("_pos") || key.endsWith("_neg")))
        return false;
      const base = String(p.name ?? "").replace(/_neg$/, "");
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    })
    .map(
      (p) =>
        `<span style="color:${p.color ?? p.stroke ?? p.fill}">●</span> ` +
        `${String(p.name ?? "").replace(/_neg$/, "")}: <b>${Number(p.value).toFixed(2)} ${unit}</b>`,
    )
    .join("<br/>");

  return (
    <div
      style={{
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        padding: "6px 10px",
        borderRadius: 4,
        fontSize: 12,
        color: theme.palette.text.primary,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{time}</div>
      <div dangerouslySetInnerHTML={{ __html: rows }} />
    </div>
  );
}

export default function EnergyChart({
  data,
  series,
  height = 220,
  unit = "kW",
  showZeroLine = false,
  timezone,
}: EnergyChartProps) {
  const theme = useTheme();
  const hasMirror = series.some((s) => s.negativeColor);

  const dayStartMs = data.length
    ? Math.min(...data.map((d) => d.time as number))
    : 0;
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;

  // Drag-to-select zoom state.
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const handleMouseDown = useCallback(
    (e: { activeLabel?: string | number }) => {
      if (e.activeLabel != null) {
        const t = Number(e.activeLabel);
        setDragStart(t);
        setDragEnd(null);
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: { activeLabel?: string | number }) => {
      if (dragStart != null && e.activeLabel != null) {
        setDragEnd(Number(e.activeLabel));
      }
    },
    [dragStart],
  );

  const handleMouseUp = useCallback(() => {
    if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
      const from = Math.min(dragStart, dragEnd);
      const to = Math.max(dragStart, dragEnd);
      // Only zoom if selection is at least 10 minutes wide.
      if (to - from >= 10 * 60 * 1000) setZoomDomain([from, to]);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const resetZoom = useCallback(() => setZoomDomain(null), []);

  // For mirror series, build chart data with two steps:
  // 1. Insert a linearly-interpolated zero-crossing point between any two consecutive
  //    original points whose signs differ. This ensures _pos and _neg areas meet at y=0
  //    instead of leaving a gap when the value jumps from e.g. +2 kW to -2 kW.
  // 2. Split each mirror series into _pos (values ≥ 0) and _neg (values ≤ 0), using
  //    null — not 0 — for the "other side" so no flat y=0 line spans the full chart.
  const chartData = useMemo(() => {
    if (!hasMirror) return data;

    const withCrossings: Record<string, number | null>[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i > 0) {
        for (const s of series) {
          if (!s.negativeColor) continue;
          const prev = data[i - 1][s.dataKey] as number | null;
          const curr = data[i][s.dataKey] as number | null;
          if (
            prev !== null &&
            curr !== null &&
            prev !== 0 &&
            curr !== 0 &&
            Math.sign(prev) !== Math.sign(curr)
          ) {
            const t0 = data[i - 1].time as number;
            const t1 = data[i].time as number;
            // Linear interpolation to find exact zero-crossing time
            const crossTime =
              t0 +
              ((t1 - t0) * Math.abs(prev)) / (Math.abs(prev) + Math.abs(curr));
            const crossRow: Record<string, number | null> = {};
            for (const key of Object.keys(data[i - 1])) {
              crossRow[key] = null;
            }
            crossRow.time = crossTime;
            crossRow[s.dataKey] = 0;
            withCrossings.push(crossRow);
          }
        }
      }
      withCrossings.push({ ...data[i] });
    }

    return withCrossings.map((d) => {
      const row: Record<string, number | null> = { ...d };
      for (const s of series) {
        if (!s.negativeColor) continue;
        const v = d[s.dataKey] as number | null;
        row[`${s.dataKey}_pos`] = v === null ? null : v >= 0 ? v : null;
        row[`${s.dataKey}_neg`] = v === null ? null : v <= 0 ? v : null;
      }
      return row;
    });
  }, [data, series, hasMirror]);

  // When zoomed, filter chartData to only the selected range so the visible portion
  // expands to fill the full chart width (zoom = filter, not just domain clamp).
  const displayData = useMemo(() => {
    if (!zoomDomain) return chartData;
    const [from, to] = zoomDomain;
    return chartData.filter((d) => {
      const t = d.time as number;
      return t >= from && t <= to;
    });
  }, [chartData, zoomDomain]);

  const xDomain = useMemo((): [number, number] | [string, string] => {
    if (zoomDomain) return zoomDomain;
    return data.length ? [dayStartMs, dayEndMs] : ["auto", "auto"];
  }, [zoomDomain, data.length, dayStartMs, dayEndMs]);

  const lastNonNull = useCallback(
    (key: string): number | null => {
      for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i][key] as number | null;
        if (v !== null) return v;
      }
      return null;
    },
    [data],
  );

  // Compute symmetric domain + explicit tick array for mirror charts so the Y-axis
  // always shows evenly-spaced, symmetric values (e.g. -4, -2, 0, 2, 4, 6, 8).
  const yRange = useMemo(() => {
    if (!hasMirror) return undefined;
    let dMin = 0;
    let dMax = 0;
    for (const s of series.filter((s) => s.negativeColor)) {
      for (const d of data) {
        const v = d[s.dataKey] as number | null;
        if (v !== null) {
          dMin = Math.min(dMin, v);
          dMax = Math.max(dMax, v);
        }
      }
    }
    const interval = niceTickInterval(dMin, dMax);
    // When one side has no real data, reserve 2 tick intervals so the region label
    // (placed at a fixed pixel offset) is always visibly below/above the zero line.
    const minNegIntervals = dMin >= 0 ? 2 : 1;
    const minPosIntervals = dMax <= 0 ? 2 : 1;
    const domainMin = Math.min(
      Math.floor(dMin / interval) * interval,
      -interval * minNegIntervals,
    );
    const domainMax = Math.max(
      Math.ceil(dMax / interval) * interval,
      interval * minPosIntervals,
    );
    const ticks: number[] = [];
    for (let v = domainMin; v <= domainMax + 1e-9; v += interval) {
      ticks.push(Math.round(v / interval) * interval);
    }
    return { domain: [domainMin, domainMax] as [number, number], ticks };
  }, [data, series, hasMirror]);

  // payload typed as readonly unknown[] so this callback is a structural supertype of
  // Recharts' TooltipContentProps — avoids fighting ValueType / NameType generics at the boundary.
  const renderTooltip = useCallback(
    (props: {
      active?: boolean;
      payload?: readonly unknown[];
      label?: number | string;
    }) => (
      <EnergyTooltip
        active={props.active}
        payload={props.payload as readonly TooltipItem[] | undefined}
        label={props.label}
        theme={theme}
        timezone={timezone}
        unit={unit}
      />
    ),
    [theme, timezone, unit],
  );

  // Build gradient <defs> and <Area> elements per series config.
  const gradients: React.ReactElement[] = [];
  const areas: React.ReactElement[] = [];

  for (const s of series) {
    if (s.type === "line") continue;

    if (!s.negativeColor) {
      const lv = lastNonNull(s.dataKey);
      // openEnd: series ends mid-day at a non-zero value — closing edge would be visible.
      const openEnd = lv !== null && lv !== 0;
      const gid = gradId(s.label);

      if (openEnd) {
        // SVG linearGradient with gradientUnits="objectBoundingBox" (default).
        // offset="100%" maps to the right edge of the area path's bounding box,
        // which is exactly the last data point — so the closing polygon edge is
        // transparent. The browser SVG engine handles this with pixel precision,
        // reliably across all renders regardless of how the React component updates.
        gradients.push(
          <linearGradient key={gid} id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
            <stop offset="99.9%" stopColor={s.color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
          </linearGradient>,
        );
      }

      areas.push(
        <Area
          key={s.label}
          type="monotone"
          dataKey={s.dataKey}
          name={s.label}
          stroke={s.color}
          strokeWidth={1.5}
          fill={openEnd ? `url(#${gid})` : s.color}
          fillOpacity={openEnd ? 1 : 0.25}
          dot={false}
          activeDot={{ r: 3, stroke: s.color }}
          isAnimationActive={false}
          connectNulls={false}
        />,
      );
    } else {
      const lv = lastNonNull(s.dataKey);
      const openEndPos = lv !== null && lv > 0;
      const openEndNeg = lv !== null && lv < 0;
      const gidPos = gradId(s.label, "-pos");
      const gidNeg = gradId(s.label, "-neg");

      if (openEndPos) {
        gradients.push(
          <linearGradient key={gidPos} id={gidPos} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
            <stop offset="99.9%" stopColor={s.color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
          </linearGradient>,
        );
      }
      if (openEndNeg) {
        gradients.push(
          <linearGradient key={gidNeg} id={gidNeg} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={s.negativeColor} stopOpacity={0.25} />
            <stop
              offset="99.9%"
              stopColor={s.negativeColor}
              stopOpacity={0.25}
            />
            <stop offset="100%" stopColor={s.negativeColor} stopOpacity={0} />
          </linearGradient>,
        );
      }

      areas.push(
        <Area
          key={`${s.label}_pos`}
          type="monotone"
          dataKey={`${s.dataKey}_pos`}
          name={s.label}
          stroke={s.color}
          strokeWidth={1.5}
          fill={openEndPos ? `url(#${gidPos})` : s.color}
          fillOpacity={openEndPos ? 1 : 0.25}
          dot={false}
          activeDot={{ r: 3, stroke: s.color }}
          isAnimationActive={false}
          connectNulls={false}
        />,
        <Area
          key={`${s.label}_neg`}
          type="monotone"
          dataKey={`${s.dataKey}_neg`}
          name={`${s.label}_neg`}
          stroke={s.negativeColor as string}
          strokeWidth={1.5}
          fill={openEndNeg ? `url(#${gidNeg})` : (s.negativeColor as string)}
          fillOpacity={openEndNeg ? 1 : 0.25}
          dot={false}
          activeDot={{ r: 3, stroke: s.negativeColor }}
          isAnimationActive={false}
          connectNulls={false}
        />,
      );
    }
  }

  return (
    <Box position="relative">
      {zoomDomain && (
        // Placed after the Y-axis (width=60) so it doesn't overlap the Import/Export labels
        // that sit on the right edge of the chart container.
        <Box position="absolute" top={4} left={64} zIndex={1}>
          <Button
            size="small"
            variant="text"
            onClick={resetZoom}
            sx={{ fontSize: 10, py: 0, minWidth: 0 }}
          >
            Reset zoom
          </Button>
        </Box>
      )}

      <Box
        onDoubleClick={resetZoom}
        data-energy-chart="true"
        sx={{
          touchAction: "pan-y",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={displayData}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <defs>{gradients}</defs>

            <CartesianGrid
              vertical={false}
              stroke={theme.palette.divider}
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={xDomain}
              tickFormatter={(v: number) => formatTimeInZone(v, timezone)}
              tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
              tickLine={{ stroke: theme.palette.divider }}
              axisLine={{ stroke: theme.palette.divider }}
              minTickGap={40}
            />

            <YAxis
              domain={
                hasMirror && yRange
                  ? yRange.domain
                  : ([0, "auto"] as [number, string])
              }
              ticks={hasMirror && yRange ? yRange.ticks : undefined}
              tickFormatter={(v: number) => {
                const n = Math.round(v * 10) / 10;
                return `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
              }}
              tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
              axisLine={false}
              tickLine={false}
              width={60}
            />

            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: theme.palette.divider, strokeWidth: 1 }}
            />

            {(hasMirror || showZeroLine) && (
              <ReferenceLine
                y={0}
                stroke={theme.palette.divider}
                strokeWidth={1}
              />
            )}

            {/* Drag-selection highlight */}
            {dragStart != null && dragEnd != null && (
              <ReferenceArea
                x1={Math.min(dragStart, dragEnd)}
                x2={Math.max(dragStart, dragEnd)}
                fill={theme.palette.primary.main}
                fillOpacity={0.08}
                stroke={theme.palette.primary.main}
                strokeOpacity={0.3}
              />
            )}

            {areas}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>

      {/* Import/Export or Discharge/Charge region labels for mirror series */}
      {series
        .filter((s) => s.negativeColor)
        .map((s) => (
          <Box key={s.label} component="span">
            {s.positiveLabel && (
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  right: 16,
                  top: 14,
                  fontSize: 10,
                  color: "text.secondary",
                  pointerEvents: "none",
                }}
              >
                {s.positiveLabel}
              </Box>
            )}
            {s.negativeLabel && (
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  right: 16,
                  bottom: 36,
                  fontSize: 10,
                  color: "text.secondary",
                  pointerEvents: "none",
                }}
              >
                {s.negativeLabel}
              </Box>
            )}
          </Box>
        ))}
    </Box>
  );
}

export function ChartContainer({ children }: { children: React.ReactNode }) {
  return <Box>{children}</Box>;
}
