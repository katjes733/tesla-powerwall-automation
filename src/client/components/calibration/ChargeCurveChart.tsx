import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useTheme, type Theme } from "@mui/material/styles";
import { useMemo, useCallback, useState } from "react";

export interface ChargeCurveBin {
  soc_percent: number;
  battery_kw: number;
  sample_count: number;
}

interface ChargeCurveChartProps {
  bins: ChargeCurveBin[];
  height?: number;
}

function niceTickInterval(dataMin: number, dataMax: number): number {
  const range = Math.max(Math.abs(dataMax - dataMin), 1);
  const rough = range / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  const niceFrac = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return niceFrac * Math.pow(10, exp);
}

interface ChartPoint {
  soc: number;
  kw: number;
}

interface ChargeCurveTooltipProps {
  active?: boolean;
  label?: number | string;
  theme: Theme;
  color: string;
  chartData: ChartPoint[];
}

function ChargeCurveTooltip({
  active,
  label,
  theme,
  color,
  chartData,
}: ChargeCurveTooltipProps) {
  if (!active || label == null || chartData.length === 0) return null;
  const hovered = Number(label);
  const nearest = chartData.reduce((prev, curr) =>
    Math.abs(curr.soc - hovered) < Math.abs(prev.soc - hovered) ? curr : prev,
  );
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
      <div style={{ fontWeight: 600, marginBottom: 4 }}>SOC {nearest.soc}%</div>
      <div>
        <span style={{ color }}>●</span> Charge rate:{" "}
        <b>{nearest.kw.toFixed(2)} kW</b>
      </div>
    </div>
  );
}

export default function ChargeCurveChart({
  bins,
  height = 160,
}: ChargeCurveChartProps) {
  const theme = useTheme();
  const color = theme.palette.primary.main;

  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const handleMouseDown = useCallback(
    (e: { activeLabel?: string | number }) => {
      if (e.activeLabel != null) {
        setDragStart(Number(e.activeLabel));
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
      if (to - from >= 2) setZoomDomain([from, to]);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const resetZoom = useCallback(() => setZoomDomain(null), []);

  const chartData = useMemo(() => {
    const data = bins.map((b) => ({ soc: b.soc_percent, kw: b.battery_kw }));
    if (data.length > 0 && data[data.length - 1].soc < 100) {
      data.push({ soc: 100, kw: 0 });
    }
    return data;
  }, [bins]);

  // Start from the last bin before 85% SOC (first point where tapering can begin),
  // always end at 100% regardless of where actual bins stop.
  const xDomain = useMemo((): [number, number] => {
    if (bins.length === 0) return [85, 100];
    const sorted = [...bins].sort((a, b) => a.soc_percent - b.soc_percent);
    const binsBelow85 = sorted.filter((b) => b.soc_percent < 85);
    const startBin =
      binsBelow85.length > 0 ? binsBelow85[binsBelow85.length - 1] : sorted[0];
    return [startBin.soc_percent, 100];
  }, [bins]);

  const displayData = useMemo(() => {
    const [from, to] = zoomDomain ?? xDomain;
    return chartData.filter((d) => d.soc >= from && d.soc <= to);
  }, [chartData, zoomDomain, xDomain]);

  const yTicks = useMemo(() => {
    if (bins.length === 0) return [0];
    const maxKw = Math.max(...bins.map((b) => b.battery_kw));
    const interval = niceTickInterval(0, maxKw);
    const domainMax = Math.ceil(maxKw / interval) * interval;
    const ticks: number[] = [];
    for (let v = 0; v <= domainMax + 1e-9; v += interval) {
      ticks.push(Math.round(v / interval) * interval);
    }
    return ticks;
  }, [bins]);

  const renderTooltip = useCallback(
    (props: { active?: boolean; label?: number | string }) => (
      <ChargeCurveTooltip
        active={props.active}
        label={props.label}
        theme={theme}
        color={color}
        chartData={chartData}
      />
    ),
    [theme, color, chartData],
  );

  if (bins.length === 0) return null;

  const yMax = yTicks[yTicks.length - 1] ?? 1;

  return (
    <Box sx={{ position: "relative" }}>
      {zoomDomain && (
        <Box sx={{ position: "absolute", top: 4, left: 64, zIndex: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={resetZoom}
            sx={{ fontSize: 10, py: 0, minWidth: 0 }}
          >
            Reset zoom
          </Button>
        </Box>
      )}

      <Box onDoubleClick={resetZoom}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={displayData}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <defs>
              <linearGradient id="ccg-kw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              stroke={theme.palette.divider}
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey="soc"
              type="number"
              domain={zoomDomain ?? xDomain}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
              tickLine={{ stroke: theme.palette.divider }}
              axisLine={{ stroke: theme.palette.divider }}
              minTickGap={30}
            />

            <YAxis
              domain={[0, yMax]}
              ticks={yTicks}
              tickFormatter={(v: number) => {
                const n = Math.round(v * 10) / 10;
                return `${n % 1 === 0 ? n : n.toFixed(1)} kW`;
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

            <Area
              type="monotone"
              dataKey="kw"
              name="Charge rate"
              stroke={color}
              strokeWidth={1.5}
              fill="url(#ccg-kw)"
              fillOpacity={1}
              dot={false}
              activeDot={{ r: 3, stroke: color }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
