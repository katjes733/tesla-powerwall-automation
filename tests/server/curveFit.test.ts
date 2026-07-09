import { describe, it, expect } from "vitest";
import {
  buildChargeCurveBins,
  lookupBatteryRateKw,
} from "~/server/util/curveFit";

// Minimal sample shape accepted by buildChargeCurveBins — creation_time plus
// the four sample_data fields recorded per tick.
function sample(
  isoTime: string,
  socPercent: number,
  batteryKw: number,
  solarKw: number,
  gridKw: number,
) {
  return {
    creation_time: isoTime,
    sample_data: {
      soc_percent: socPercent,
      battery_kw: batteryKw,
      solar_kw: solarKw,
      grid_kw: gridKw,
    },
  } as any;
}

const SESSION_BASE_MS = new Date("2026-07-02T03:00:00.000Z").getTime();
const minuteOffset = (minute: number) =>
  new Date(SESSION_BASE_MS + minute * 60_000).toISOString();

// A clean, grid-forced "full session" spanning soc 71→99 at a flat ~16.3kW,
// like a genuine manual curve calibration run at night (solar = 0). Each SOC
// integer gets several one-minute samples so every bucket clears the
// bin-population threshold (MIN_BIN_SAMPLES). Returns the minute after the
// last sample, so callers can append more rows to the same session (no >1hr
// gap) without independently having to reach the session-completeness SOC.
function cleanMaxRateSession(
  startMinute: number,
  socStart = 71,
  socEnd = 99,
): { rows: ReturnType<typeof sample>[]; nextMinute: number } {
  const rows: ReturnType<typeof sample>[] = [];
  let minute = startMinute;
  for (let soc = socStart; soc <= socEnd; soc++) {
    for (let i = 0; i < 4; i++) {
      rows.push(sample(minuteOffset(minute), soc + i * 0.2, 16.3, 0, 22));
      minute++;
    }
  }
  return { rows, nextMinute: minute };
}

describe("buildChargeCurveBins — sample validity filter", () => {
  it("excludes a household-load sample where grid_kw is high but battery only received solar", () => {
    // Regression: soc 72, battery≈solar (~2kW), grid_kw=5kW — the 5kW is
    // going to household load, not the battery. Old filter (raw grid_kw
    // check) would have accepted this; battery_kw - solar_kw is ~0. Placed
    // right after the clean session (same session by time-contiguity) so the
    // session-completeness filter isn't what's excluding these — only the
    // contribution filter should be.
    const clean = cleanMaxRateSession(0);
    const contaminated = Array.from({ length: 10 }, (_, i) =>
      sample(minuteOffset(clean.nextMinute + i), 72 + i * 0.05, 2.0, 2.05, 5.0),
    );
    const candidate = buildChargeCurveBins([...clean.rows, ...contaminated]);
    expect(candidate).not.toBeNull();
    const bin72 = candidate!.bins.find((b) => b.soc_percent === 72);
    expect(bin72).toBeDefined();
    // Only the clean session's samples should have survived for bucket 72 —
    // median stays close to the forced max rate, not dragged toward ~2kW.
    expect(bin72!.battery_kw).toBeGreaterThan(15);
  });

  it("excludes a fully solar-only sample (grid_kw = 0) even above the CV taper exemption SOC", () => {
    // Regression: soc 96 (>= CV_TAPER_SOC_EXEMPT_PERCENT), grid fully off,
    // battery draws only what solar provides. The exemption used to bypass
    // the grid check entirely above 95% SOC — this must still be excluded
    // since gridContributionKw ends up <= 0.
    const clean = cleanMaxRateSession(0);
    const contaminated = Array.from({ length: 10 }, (_, i) =>
      sample(minuteOffset(clean.nextMinute + i), 96 + i * 0.02, 0.9, 4.68, 0),
    );
    const candidate = buildChargeCurveBins([...clean.rows, ...contaminated]);
    expect(candidate).not.toBeNull();
    const bin96 = candidate!.bins.find((b) => b.soc_percent === 96);
    expect(bin96).toBeDefined();
    expect(bin96!.battery_kw).toBeGreaterThan(10);
  });

  it("keeps a near-100% SOC sample with only a trickle of real grid contribution", () => {
    // A tiny but genuinely positive grid contribution above the taper
    // exemption SOC (natural BMS ceiling near full charge) must still count.
    const clean = cleanMaxRateSession(0, 71, 98);
    const trickle = [98.83, 98.83, 98.83].map((soc, i) =>
      sample(minuteOffset(clean.nextMinute + i), soc, 0.54, 0, 5.15),
    );
    const candidate = buildChargeCurveBins([...clean.rows, ...trickle]);
    expect(candidate).not.toBeNull();
    const bin98 = candidate!.bins.find((b) => b.soc_percent === 98);
    expect(bin98).toBeDefined();
  });

  it("still accepts a genuine grid-driven sample with concurrent solar (mixed daytime session)", () => {
    // battery_kw well above solar_kw — grid is clearly reaching the battery
    // even though solar is also contributing. Must not be excluded.
    const clean = cleanMaxRateSession(0);
    const mixed = Array.from({ length: 10 }, (_, i) =>
      sample(
        minuteOffset(clean.nextMinute + i),
        81 + i * 0.05,
        16.3,
        4.7,
        16.3,
      ),
    );
    const candidate = buildChargeCurveBins([...clean.rows, ...mixed]);
    expect(candidate).not.toBeNull();
    const bin81 = candidate!.bins.find((b) => b.soc_percent === 81);
    expect(bin81).toBeDefined();
    expect(bin81!.battery_kw).toBeGreaterThan(15);
  });
});

describe("lookupBatteryRateKw", () => {
  it("falls back to belowRangeRateKw below the lowest bin instead of extrapolating it", () => {
    const bins = [
      { soc_percent: 71, battery_kw: 0.93, sample_count: 47 },
      { soc_percent: 73, battery_kw: 16, sample_count: 69 },
    ];
    expect(lookupBatteryRateKw(62, bins, 16.32)).toBe(16.32);
    expect(lookupBatteryRateKw(71, bins, 16.32)).toBe(16.32);
  });
});
