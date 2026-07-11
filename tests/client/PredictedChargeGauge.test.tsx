/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  PredictedChargeGauge,
  formatDayTime,
} from "~/client/components/powerwall/SiteCard";
import type { SmartChargingData } from "~/server/util/fleet";

const theme = createTheme();

function renderGauge(data: SmartChargingData, size = 88) {
  return render(
    <ThemeProvider theme={theme}>
      <PredictedChargeGauge data={data} timezone="UTC" size={size} />
    </ThemeProvider>,
  );
}

const BASE: SmartChargingData = {
  desired: "disabled",
  current: "disabled",
  action: "no_change",
  soc: 40,
  targetSoc: 100,
  forecastMethod: "linear-fallback",
  estimatedSolarKwh: null,
  weatherFactor: null,
  batteryChargeRateFromGridKw: null,
  liveKw: { solar: 0, load: 0, grid: 0, battery: 0 },
  chargeRateKw: 5,
  chargeRateSource: "formula",
  chargeRateCurveSource: "defaults",
  reason: "test fixture",
  situation: "in_peak",
  gridEnergyKwh: null,
  solarCoversAboveSocPct: null,
  peakOrDeadlineAt: null,
  predictedSocAtPeak: null,
  targetGapPct: 0,
  gridStartAt: null,
  windowReopensAt: null,
  solarContributionPct: null,
  gridContributionPct: null,
};

describe("PredictedChargeGauge — simple/paused mode", () => {
  it.each([
    ["in_peak", "On-Peak"],
    ["deadline_passed", "Past Deadline"],
    ["target_reached", "At Target"],
    ["no_peak_found", "No Peak"],
  ] as const)(
    "renders the paused label for %s, not a percentage",
    (situation, label) => {
      const { container } = renderGauge({
        ...BASE,
        situation,
        peakOrDeadlineAt: null,
        predictedSocAtPeak: 40,
        targetGapPct: 60,
      });

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^of /)).not.toBeInTheDocument();

      // No colored forecast arcs, no target tick, in paused mode.
      const circles = container.querySelectorAll("circle");
      expect(circles).toHaveLength(2); // track + current-fill only
      expect(container.querySelector('circle[stroke="#f59e0b"]')).toBeNull();
      expect(container.querySelector("line")).toBeNull();
    },
  );
});

describe("PredictedChargeGauge — rich forecast mode", () => {
  it("uses gridStartAt (not peakOrDeadlineAt) for the 'waiting' caption", () => {
    renderGauge({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-20T20:45:00.000Z", // deliberately different day
      gridStartAt: "2026-07-13T19:30:00.000Z",
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });

    const expectedCaption = `Starts ${formatDayTime("2026-07-13T19:30:00.000Z", "UTC")}`;
    const wrongCaption = `Starts ${formatDayTime("2026-07-20T20:45:00.000Z", "UTC")}`;
    expect(screen.getByText(expectedCaption)).toBeInTheDocument();
    expect(screen.queryByText(wrongCaption)).not.toBeInTheDocument();
  });

  it("uses windowReopensAt for the 'blocked_window' caption", () => {
    renderGauge({
      ...BASE,
      situation: "blocked_window",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      windowReopensAt: "2026-07-14T00:00:00.000Z",
      predictedSocAtPeak: 50,
      targetGapPct: 50,
    });

    expect(
      screen.getByText(
        `Resumes ${formatDayTime("2026-07-14T00:00:00.000Z", "UTC")}`,
      ),
    ).toBeInTheDocument();
  });

  it("shows 'Charging now' for grid_needed", () => {
    renderGauge({
      ...BASE,
      situation: "grid_needed",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });
    expect(screen.getByText("Charging now")).toBeInTheDocument();
  });

  it("shows 'Solar only — no grid needed' and omits the grid contribution for solar_sufficient", () => {
    renderGauge({
      ...BASE,
      situation: "solar_sufficient",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      predictedSocAtPeak: 100,
      targetGapPct: 0,
      solarContributionPct: 60,
      gridContributionPct: 0,
    });
    // Caption and contribution numbers render as separate lines so neither
    // reads as one crammed, wrapped string.
    expect(screen.getByText("Solar only — no grid needed")).toBeInTheDocument();
    expect(screen.getByText("☀ 60%")).toBeInTheDocument();
    expect(screen.queryByText(/⚡/)).not.toBeInTheDocument();
  });

  it("clamps an overflowing solarContributionPct to the ring's remaining room instead of showing a confusing >100% number", () => {
    const size = 88;
    // A large solar forecast against a small deficit can legitimately
    // compute to e.g. 147% of total battery capacity server-side — display
    // must cap both the printed number and the arc at (100 - soc), the only
    // room actually left on the ring, so it never contradicts the
    // already-capped 100% center reading or overshoots the 0-100 arc scale.
    const { container } = renderGauge(
      {
        ...BASE,
        soc: 45,
        situation: "solar_sufficient",
        peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
        predictedSocAtPeak: 100,
        targetGapPct: 0,
        solarContributionPct: 147,
        gridContributionPct: 0,
      },
      size,
    );

    expect(screen.getByText("☀ 55%")).toBeInTheDocument();
    expect(screen.queryByText(/147/)).not.toBeInTheDocument();

    const strokeWidth = (6 * size) / 44;
    const r = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * r;
    const amber = container.querySelector('circle[stroke="#f59e0b"]')!;
    const dashLength = Number(
      amber.getAttribute("stroke-dasharray")?.split(" ")[0],
    );
    expect(dashLength).toBeCloseTo((55 / 100) * circumference, 5);
  });

  it("labels the predicted number and its target unambiguously in the center", () => {
    renderGauge({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 100,
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });
    expect(screen.getByText("Predicted")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("target 100%")).toBeInTheDocument();
  });

  it.each([
    [0, "false"],
    [2, "false"], // boundary — not a shortfall
    [5, "true"],
  ])("marks data-shortfall=%s for targetGapPct=%s", (gap, expected) => {
    const { getByTestId } = renderGauge({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetGapPct: gap as number,
    });
    expect(getByTestId("predicted-charge-gauge")).toHaveAttribute(
      "data-shortfall",
      expected,
    );
  });

  it("computes arc lengths proportional to soc/solar/grid percentages", () => {
    const size = 88;
    // Matches the main SOC gauge's real rendered thickness: MUI's
    // CircularProgress renders `thickness` inside a fixed 44-unit viewBox
    // scaled up to `size`, so real thickness = thickness * (size / 44).
    const strokeWidth = (6 * size) / 44;
    const r = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * r;

    const { container } = renderGauge(
      {
        ...BASE,
        situation: "waiting",
        peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
        gridStartAt: "2026-07-13T19:30:00.000Z",
        soc: 40,
        solarContributionPct: 20,
        gridContributionPct: 10,
        predictedSocAtPeak: 70,
      },
      size,
    );

    const circles = container.querySelectorAll("circle");
    // track, current(grey), solar(amber), grid(purple)
    expect(circles).toHaveLength(4);

    const grey = circles[1];
    const amber = container.querySelector('circle[stroke="#f59e0b"]')!;
    const purple = circles[3];

    const dashLength = (el: Element) =>
      Number(el.getAttribute("stroke-dasharray")?.split(" ")[0]);
    const dashOffset = (el: Element) =>
      Number(el.getAttribute("stroke-dashoffset"));

    expect(dashLength(grey)).toBeCloseTo((40 / 100) * circumference, 5);
    expect(dashOffset(grey)).toBeCloseTo(0, 5);

    expect(dashLength(amber)).toBeCloseTo((20 / 100) * circumference, 5);
    expect(dashOffset(amber)).toBeCloseTo(-(40 / 100) * circumference, 5);

    expect(dashLength(purple)).toBeCloseTo((10 / 100) * circumference, 5);
    expect(dashOffset(purple)).toBeCloseTo(-(60 / 100) * circumference, 5);

    expect(container.querySelector("line")).not.toBeNull();
  });
});

describe("formatDayTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("day-qualifies Today / Tomorrow / weekday against a fixed 'now'", () => {
    vi.useFakeTimers();
    // Friday, 2026-07-10 12:00 UTC
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    expect(formatDayTime("2026-07-10T19:30:00.000Z", "UTC")).toMatch(
      /^Today, /,
    );
    expect(formatDayTime("2026-07-11T06:00:00.000Z", "UTC")).toMatch(
      /^Tomorrow, /,
    );
    // Three days out (e.g. Friday -> Monday, skipping a no-peak weekend).
    expect(formatDayTime("2026-07-13T19:45:00.000Z", "UTC")).toMatch(
      /^Monday, /,
    );
  });
});
