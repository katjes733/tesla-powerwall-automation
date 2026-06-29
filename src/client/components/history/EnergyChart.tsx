import ReactECharts from "echarts-for-react";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { useRef, useCallback } from "react";

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

// Compute the "nice" tick interval ECharts would pick for a given data range,
// targeting ~5 ticks. Used to align forced axis boundaries to the tick grid.
function niceTickInterval(dataMin: number, dataMax: number): number {
  const range = Math.max(Math.abs(dataMax - dataMin), 1);
  const rough = range / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  const niceFrac = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return niceFrac * Math.pow(10, exp);
}

// Split a value series into positive and negative halves.
//
// For non-zero sign changes an interpolated zero-crossing timestamp is inserted
// into both series so the areas meet exactly at y=0.
//
// For transitions through zero (prevV===0 → negative, or negative → nextV===0)
// explicit [t, 0] points are inserted at the same timestamp as the boundary
// value, producing a visible closing/opening line down to the zero axis rather
// than an abrupt start/end at the non-zero value.
function splitAtZero(
  data: Record<string, number | null>[],
  dataKey: string,
): {
  positive: [number, number | null][];
  negative: [number, number | null][];
} {
  const pos: [number, number | null][] = [];
  const neg: [number, number | null][] = [];

  for (let i = 0; i < data.length; i++) {
    const t = data[i].time as number;
    const v = data[i][dataKey] as number | null;
    const prevT = i > 0 ? (data[i - 1].time as number) : null;
    const prevV = i > 0 ? (data[i - 1][dataKey] as number | null) : null;
    const nextV =
      i < data.length - 1 ? (data[i + 1][dataKey] as number | null) : null;

    if (v === null) {
      pos.push([t, null]);
      neg.push([t, null]);
      continue;
    }

    // Non-zero sign change: insert interpolated zero-crossing into both series.
    if (prevV !== null && prevV * v < 0) {
      const t0 =
        prevT! +
        (t - prevT!) * (Math.abs(prevV) / (Math.abs(prevV) + Math.abs(v)));
      pos.push([t0, 0]);
      neg.push([t0, 0]);
    }

    if (v > 0) {
      // When entering from null (data starts positive), open with an explicit zero.
      if (prevV === null) pos.push([t, 0]);
      pos.push([t, v]);
      neg.push([t, null]);
      // Close positive run when exiting to zero / null / negative.
      if (nextV === null || nextV <= 0) pos.push([t, 0]);
    } else if (v < 0) {
      if (prevV === null) {
        // Data starts with negative: open with a zero at the same timestamp.
        neg.push([t, 0]);
      } else if (prevV === 0) {
        // The previous entry in neg is [prevT, null]. Retroactively make it [prevT, 0]
        // so the neg series starts exactly where the pos series' last zero sits —
        // eliminating the one-interval gap between the two series.
        neg[neg.length - 1] = [prevT!, 0];
      }
      pos.push([t, null]);
      neg.push([t, v]);
      // Close negative run when exiting to zero / null / positive.
      if (nextV === null || nextV >= 0) neg.push([t, 0]);
    } else {
      // v === 0: belongs to the positive (baseline) series only.
      // When coming out of a negative run the previous pos entry is [prevT, null].
      // Retroactively change it to [prevT, 0] so pos and neg share the same last
      // zero timestamp, eliminating the one-interval end gap.
      if (prevV !== null && prevV < 0) {
        pos[pos.length - 1] = [prevT!, 0];
      }
      pos.push([t, 0]);
      neg.push([t, null]);
    }
  }

  return { positive: pos, negative: neg };
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
  const chartRef = useRef<ReactECharts>(null);

  const activateBoxZoom = useCallback(() => {
    chartRef.current?.getEchartsInstance()?.dispatchAction({
      type: "takeGlobalCursor",
      key: "dataZoomSelect",
      dataZoomSelectActive: true,
    });
  }, []);

  const handleChartReady = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    activateBoxZoom();
    // Double-click anywhere on the chart resets zoom and re-engages box-select mode.
    instance.on("dblclick", () => {
      instance.dispatchAction({ type: "restore" });
      activateBoxZoom();
    });
  }, [activateBoxZoom]);

  // Build echarts series list. Series with negativeColor are split into two
  // independent area series (positive / negative) so we avoid visualMap + areaStyle
  // gradient coordinate crashes in ECharts.
  const echartseries = series.flatMap((s) => {
    const isArea = s.type !== "line";
    const base = {
      name: s.label,
      type: "line",
      symbol: "none",
      sampling: "lttb",
      ...(isArea ? { areaStyle: { opacity: 0.25 } } : {}),
    };

    if (!s.negativeColor) {
      return [
        {
          ...base,
          data: data.map((d) => [d.time as number, d[s.dataKey] ?? null]),
          lineStyle: { width: 1.5, color: s.color },
          itemStyle: { color: s.color },
        },
      ];
    }

    const { positive, negative } = splitAtZero(data, s.dataKey);
    return [
      {
        ...base,
        data: positive,
        lineStyle: { width: 1.5, color: s.color },
        itemStyle: { color: s.color },
      },
      {
        ...base,
        data: negative,
        lineStyle: { width: 1.5, color: s.negativeColor },
        itemStyle: { color: s.negativeColor },
      },
    ];
  });

  // One dot per hour along y=0. Named "" so the tooltip formatter can skip it.
  if (showZeroLine && data.length) {
    const times = data.map((d) => d.time as number);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const firstHour = Math.ceil(tMin / 3_600_000) * 3_600_000;
    const dots: [number, number][] = [];
    for (let t = firstHour; t <= tMax; t += 3_600_000) {
      dots.push([t, 0]);
    }
    echartseries.push({
      name: "",
      type: "scatter",
      data: dots,
      symbol: "circle",
      symbolSize: 4,
      itemStyle: { color: theme.palette.text.secondary },
      silent: true,
      animation: false,
      emphasis: { disabled: true },
    } as unknown as (typeof echartseries)[0]);
  }

  // Derive full-day x-axis bounds from the first data point (always local
  // midnight per the Tesla API) so the axis always spans 00:00–24:00 even
  // when today's data ends mid-day.
  const dayStartMs = data.length
    ? Math.min(...data.map((d) => d.time as number))
    : 0;
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;

  const option = {
    animation: false,
    grid: { top: 8, right: 12, bottom: 32, left: 60, containLabel: false },
    xAxis: {
      type: "time",
      ...(data.length ? { min: dayStartMs, max: dayEndMs } : {}),
      axisLabel: {
        fontSize: 11,
        color: theme.palette.text.secondary,
        formatter: (value: number) => formatTimeInZone(value, timezone),
        hideOverlap: true,
      },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: theme.palette.divider } },
      axisTick: { lineStyle: { color: theme.palette.divider } },
    },
    yAxis: {
      type: "value",
      // For mirror charts, always reserve at least 20% of the absolute max on
      // the opposite side of zero so the positive/negative region labels have
      // room to display even when all data falls on one side.
      ...(series.some((s) => s.negativeColor)
        ? {
            min: (value: { min: number; max: number }) => {
              const interval = niceTickInterval(value.min, value.max);
              // Snap to tick grid; if all data is non-negative, reserve one step below zero.
              if (value.min >= 0) return -interval;
              return Math.min(
                Math.floor(value.min / interval) * interval,
                -interval,
              );
            },
            max: (value: { min: number; max: number }) => {
              const interval = niceTickInterval(value.min, value.max);
              // Snap to tick grid; if all data is non-positive, reserve one step above zero.
              if (value.max <= 0) return interval;
              return Math.max(
                Math.ceil(value.max / interval) * interval,
                interval,
              );
            },
          }
        : {}),
      axisLabel: {
        fontSize: 11,
        color: theme.palette.text.secondary,
        formatter: (v: number) => {
          // Avoid floating-point display artefacts on axis tick labels.
          const n = Math.round(v * 10) / 10;
          return `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
        },
      },
      splitLine: {
        lineStyle: { color: theme.palette.divider, type: "dashed" as const },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: { color: theme.palette.divider },
      },
      backgroundColor: theme.palette.background.paper,
      borderColor: theme.palette.divider,
      borderWidth: 1,
      textStyle: { color: theme.palette.text.primary, fontSize: 12 },
      formatter: (
        params: {
          axisValue: number;
          color: string;
          seriesName: string;
          value: [number, number | null];
        }[],
      ) => {
        if (!params.length) return "";
        const time = formatTimeInZone(params[0].axisValue, timezone);
        // De-duplicate series by name (split series share the same label).
        const seen = new Set<string>();
        const rows = params
          .filter((p) => {
            const v = p.value[1];
            if (p.seriesName === "") return false; // zero-line dot series
            if (v === null || v === undefined) return false;
            if (seen.has(p.seriesName)) return false;
            seen.add(p.seriesName);
            return true;
          })
          .map(
            (p) =>
              `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${Number(p.value[1]).toFixed(2)} ${unit}</b>`,
          )
          .join("<br/>");
        return `<div style="font-weight:600;margin-bottom:4px">${time}</div>${rows}`;
      },
    },
    // Overlay region labels for split series (above / below zero line).
    // Positioned at the top and bottom of the grid area so they always sit in
    // the correct half regardless of the actual data range.
    graphic: series.flatMap((s) => {
      if (!s.negativeColor) return [];
      const textStyle = {
        fontSize: 10,
        fill: theme.palette.text.secondary,
      };
      const items = [];
      if (s.positiveLabel) {
        items.push({
          type: "text",
          right: 16,
          top: 14,
          style: { ...textStyle, text: s.positiveLabel },
          silent: true,
        });
      }
      if (s.negativeLabel) {
        items.push({
          type: "text",
          right: 16,
          bottom: 36,
          style: { ...textStyle, text: s.negativeLabel },
          silent: true,
        });
      }
      return items;
    }),
    // Scroll-wheel zoom on x-axis; drag-pan is available after zooming in.
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
      },
    ],
    // Toolbox provides the box-select zoom cursor and the restore action that
    // double-click also triggers. Icons are hidden — interaction is driven by
    // the dispatchAction calls in handleChartReady rather than toolbar clicks.
    toolbox: {
      show: true,
      feature: {
        dataZoom: { yAxisIndex: false },
        restore: {},
      },
      // Push icons off-screen so they don't clutter the chart.
      right: -9999,
    },
    series: echartseries,
  };

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      onChartReady={handleChartReady}
      style={{ height: `${height}px`, width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}

export function ChartContainer({ children }: { children: React.ReactNode }) {
  return <Box>{children}</Box>;
}
