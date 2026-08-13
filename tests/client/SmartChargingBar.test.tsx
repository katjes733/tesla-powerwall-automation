/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { SmartChargingBar } from "~/client/components/powerwall/SiteCard";
import { formatDayTime } from "~/client/components/powerwall/dateFormat";
import type { SmartChargingData } from "~/server/util/fleet";

const theme = createTheme();

function renderBar(data: SmartChargingData) {
  return render(
    <ThemeProvider theme={theme}>
      <SmartChargingBar data={data} timezone="UTC" />
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
  radiationRatio: null,
};

describe("SmartChargingBar — simple/paused mode", () => {
  it.each([
    ["in_peak", "On-Peak"],
    ["deadline_passed", "Past Deadline"],
    ["target_reached", "At Target"],
    ["no_peak_found", "No Peak"],
  ] as const)(
    "renders the paused label for %s, not a percentage",
    (situation, label) => {
      const { container } = renderBar({
        ...BASE,
        situation,
        peakOrDeadlineAt: null,
        predictedSocAtPeak: 40,
        targetGapPct: 60,
      });

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^target /)).not.toBeInTheDocument();

      // No solar/grid segments or target tick in paused mode.
      expect(
        container.querySelector('[data-testid="solar-bar-segment"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="grid-bar-segment"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="target-bar-tick"]'),
      ).toBeNull();
    },
  );
});

describe("SmartChargingBar — rich forecast mode", () => {
  it("uses gridStartAt (not peakOrDeadlineAt) for the 'waiting' caption", () => {
    renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-20T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });

    const expectedCaption = `Starts ${formatDayTime("2026-07-13T19:30:00.000Z", "UTC")}`;
    expect(screen.getByText(expectedCaption)).toBeInTheDocument();
  });

  it("shows 'Solar only — no grid needed' and omits the grid contribution for solar_sufficient", () => {
    renderBar({
      ...BASE,
      situation: "solar_sufficient",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      predictedSocAtPeak: 100,
      targetGapPct: 0,
      solarContributionPct: 60,
      gridContributionPct: 0,
    });
    expect(screen.getByText("Solar only — no grid needed")).toBeInTheDocument();
    expect(screen.getByText("☀ 60%")).toBeInTheDocument();
    expect(screen.queryByText(/⚡/)).not.toBeInTheDocument();
  });

  it("drops the grid contribution label to a second line when it would overlap the solar label", () => {
    renderBar({
      ...BASE,
      soc: 90,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 100,
      predictedSocAtPeak: 96,
      targetGapPct: 4,
      solarContributionPct: 2,
      gridContributionPct: 4,
    });

    // Natural centers (91% and 94%) are only 3 points apart — closer than a
    // "☀ N%"-sized label is wide — so grid drops to a second line, still
    // centered on its own segment (no horizontal change for either label).
    const solarLabel = screen.getByText("☀ 2%");
    expect(solarLabel).toHaveStyle({ left: "91%", top: "0px" });
    expect(screen.getByText("⚡ 4%")).toHaveStyle({
      left: "94%",
      top: "14px",
    });

    // The row's own reserved height never changes — the dropped label
    // overflows it rather than growing it, so nothing below (the caption)
    // shifts position because of the collision.
    expect(solarLabel.parentElement).toHaveStyle({ height: "14px" });
  });

  it("leaves solar/grid contribution labels on one line at their natural segment centers when there's no collision risk", () => {
    renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      soc: 40,
      targetSoc: 70,
      solarContributionPct: 20,
      gridContributionPct: 10,
      predictedSocAtPeak: 70,
    });

    // Segments are wide enough apart (15-point gap) that no stacking is
    // needed — labels display exactly as before, both on line one.
    expect(screen.getByText("☀ 20%")).toHaveStyle({ left: "50%", top: "0px" });
    expect(screen.getByText("⚡ 10%")).toHaveStyle({ left: "65%", top: "0px" });
  });

  it("clamps an overflowing solarContributionPct to the bar's remaining room instead of showing a confusing >100% number", () => {
    const { container } = renderBar({
      ...BASE,
      soc: 45,
      situation: "solar_sufficient",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      predictedSocAtPeak: 100,
      targetGapPct: 0,
      solarContributionPct: 147,
      gridContributionPct: 0,
    });

    expect(screen.getByText("☀ 55%")).toBeInTheDocument();
    expect(screen.queryByText(/147/)).not.toBeInTheDocument();

    const solarSegment = container.querySelector(
      '[data-testid="solar-bar-segment"]',
    ) as HTMLElement;
    expect(solarSegment.style.width).toBe("55%");
  });

  it("labels the predicted number and its target unambiguously inside the bar", () => {
    renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 100,
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("target 100%")).toBeInTheDocument();
  });

  it.each([
    [0, "false"],
    [2, "false"], // boundary — not a shortfall
    [5, "true"],
  ])("marks data-shortfall=%s for targetGapPct=%s", (gap, expected) => {
    const { getByTestId } = renderBar({
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

  it("sizes the soc/solar/grid segments and the target tick proportionally to their percentages", () => {
    const { container } = renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      soc: 40,
      targetSoc: 70,
      solarContributionPct: 20,
      gridContributionPct: 10,
      predictedSocAtPeak: 70,
    });

    const socSegment = container.querySelector(
      '[data-testid="soc-bar-segment"]',
    ) as HTMLElement;
    const solarSegment = container.querySelector(
      '[data-testid="solar-bar-segment"]',
    ) as HTMLElement;
    const gridSegment = container.querySelector(
      '[data-testid="grid-bar-segment"]',
    ) as HTMLElement;
    const targetTick = container.querySelector(
      '[data-testid="target-bar-tick"]',
    ) as HTMLElement;

    expect(socSegment.style.left).toBe("0px");
    expect(socSegment.style.width).toBe("40%");
    expect(solarSegment.style.left).toBe("40%");
    expect(solarSegment.style.width).toBe("20%");
    expect(gridSegment.style.left).toBe("60%");
    expect(gridSegment.style.width).toBe("10%");
    expect(targetTick.style.left).toBe("70%");
  });

  it("renders the target tick before the bar in DOM order, so the bar's predicted/target text always paints on top of it", () => {
    const { container } = renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 100,
      predictedSocAtPeak: 92,
      targetGapPct: 8,
    });

    const wrapper = container.querySelector(
      '[data-testid="target-bar-tick"]',
    )!.parentElement!;
    const children = Array.from(wrapper.children);
    const tickIndex = children.findIndex(
      (el) => el.getAttribute("data-testid") === "target-bar-tick",
    );
    const barIndex = children.findIndex((el) =>
      el.querySelector('[data-testid="soc-bar-segment"]'),
    );
    expect(tickIndex).toBeGreaterThanOrEqual(0);
    expect(barIndex).toBeGreaterThan(tickIndex);
  });

  it("shows a subtle percent label for the target tick, and colors the tick amber on a shortfall", () => {
    const shortfall = renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 90,
      predictedSocAtPeak: 70,
      targetGapPct: 20,
    });
    expect(shortfall.getByText("90%")).toBeInTheDocument();
    const shortfallTick = shortfall.container.querySelector(
      '[data-testid="target-bar-tick"]',
    ) as HTMLElement;
    expect(shortfallTick.style.backgroundColor).toBe(
      "rgb(237, 108, 2)", // theme.palette.warning.main (default MUI theme)
    );
    shortfall.unmount();

    const onTrack = renderBar({
      ...BASE,
      situation: "waiting",
      peakOrDeadlineAt: "2026-07-13T20:45:00.000Z",
      gridStartAt: "2026-07-13T19:30:00.000Z",
      targetSoc: 90,
      predictedSocAtPeak: 90,
      targetGapPct: 0,
    });
    const onTrackTick = onTrack.container.querySelector(
      '[data-testid="target-bar-tick"]',
    ) as HTMLElement;
    expect(onTrackTick.style.backgroundColor).not.toBe("rgb(237, 108, 2)");
  });
});
