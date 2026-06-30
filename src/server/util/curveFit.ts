import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import type { IBasicEntity } from "~/server/types/common";

export interface ChargeCurveBin {
  soc_percent: number;
  battery_kw: number;
  sample_count: number;
  // Accumulated EWMA confidence — starts at EWMA_ALPHA for newly introduced bins,
  // asymptotically approaches 1.0 as more sessions are blended in.
  // Absent on curves stored before EWMA was introduced; treated as 1.0 (fully trusted).
  ewma_weight?: number;
}

export interface ChargeCurveCalibrationData {
  bins: ChargeCurveBin[];
  total_sample_count: number;
  soc_range_percent: number;
  data_window_days: number;
  built_at: string;
}

const MIN_BIN_SAMPLES = 3;
const MIN_BINS_REQUIRED = 10;
const MIN_SOC_RANGE_PERCENT = 8;
const SAMPLE_RETENTION_DAYS = 60;

// Minimum grid contribution to treat a sample as BMS-limited rather than
// supply-limited. Solar-only charging may under-drive the battery, making
// battery_kw reflect solar availability rather than the true acceptance curve.
const MIN_GRID_KW_FOR_SAMPLE = 1.0;
// Maximum SOC at which a calibration session must have started. Ensures the
// dataset covers the CC region and carries through the full CV taper to ~100%.
// Used both here (dataset gate) and in the manual calibration route (start gate).
export const MAX_CURVE_START_SOC_PERCENT = 85;

// Blend factor applied per scheduler run. New candidate data moves each bin
// at most this fraction toward the new value, so a single session has limited
// influence over an established curve. After ~10 sessions a bin is ~80% updated.
export const EWMA_ALPHA = 0.15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildChargeCurveBins(
  samples: Pick<
    IBasicEntity & ISiteCalibrationSample,
    "sample_data" | "creation_time"
  >[],
): ChargeCurveCalibrationData | null {
  if (samples.length === 0) return null;

  // Only use samples where grid is contributing ≥ MIN_GRID_KW_FOR_SAMPLE.
  // This excludes solar-only periods where battery_kw is capped by solar
  // availability rather than by the battery BMS acceptance curve.
  const valid = samples.filter(
    (s) => Number(s.sample_data.grid_kw) >= MIN_GRID_KW_FOR_SAMPLE,
  );
  if (valid.length === 0) return null;

  // Reject datasets that don't cover the CC region. Without samples at or below
  // this threshold the curve would consist of taper fragments only, which the
  // forecaster would flat-extrapolate incorrectly below the lowest calibrated bin.
  const minValidSoc = Math.min(
    ...valid.map((s) => Number(s.sample_data.soc_percent)),
  );
  if (minValidSoc > MAX_CURVE_START_SOC_PERCENT) return null;

  const buckets = new Map<number, number[]>();
  for (const s of valid) {
    const bucket = Math.floor(Number(s.sample_data.soc_percent));
    const existing = buckets.get(bucket);
    if (existing) {
      existing.push(Number(s.sample_data.battery_kw));
    } else {
      buckets.set(bucket, [Number(s.sample_data.battery_kw)]);
    }
  }

  const bins: ChargeCurveBin[] = [];
  for (const [bucket, values] of buckets.entries()) {
    if (values.length < MIN_BIN_SAMPLES) continue;
    bins.push({
      soc_percent: bucket + 0.5,
      battery_kw: Math.round(median(values) * 1000) / 1000,
      sample_count: values.length,
    });
  }

  bins.sort((a, b) => a.soc_percent - b.soc_percent);

  if (bins.length < MIN_BINS_REQUIRED) return null;

  const minSoc = bins[0].soc_percent;
  const maxSoc = bins[bins.length - 1].soc_percent;
  const socRangePercent = maxSoc - minSoc;

  if (socRangePercent < MIN_SOC_RANGE_PERCENT) return null;

  const creationTimes = valid.map((s) =>
    new Date(s.creation_time as unknown as string).getTime(),
  );
  const oldestMs = Math.min(...creationTimes);
  const newestMs = Math.max(...creationTimes);
  const dataWindowDays = Math.round((newestMs - oldestMs) / (86400 * 1000));

  return {
    bins,
    total_sample_count: valid.length,
    soc_range_percent: socRangePercent,
    data_window_days: dataWindowDays,
    built_at: new Date().toISOString(),
  };
}

export function meetsQualityThreshold(
  candidate: ChargeCurveCalibrationData | null,
  existing?: ChargeCurveCalibrationData | null,
): boolean {
  if (!candidate) return false;
  if (candidate.bins.length < MIN_BINS_REQUIRED) return false;
  if (candidate.soc_range_percent < MIN_SOC_RANGE_PERCENT) return false;
  if (!existing) return true;

  // The existing curve may have been built from samples that have since been
  // purged. Once the curve is older than the retention window, its source data
  // no longer exists and the current population is a different dataset — always
  // rebuild in that case so drifting medians are captured.
  const existingAgeMs = Date.now() - new Date(existing.built_at).getTime();
  const retentionMs = SAMPLE_RETENTION_DAYS * 24 * 3600 * 1000;
  if (existingAgeMs >= retentionMs) return true;

  const hasBroaderCoverage = candidate.bins.length > existing.bins.length;
  const hasMoreSamples =
    candidate.total_sample_count >= existing.total_sample_count * 1.2;

  return hasBroaderCoverage || hasMoreSamples;
}

// Structural-only quality check used by the scheduler before blending a candidate
// into the existing curve. Does not compare against the existing curve — that
// gate is only relevant for full replacement (manual calibration path).
export function isValidCandidate(
  candidate: ChargeCurveCalibrationData | null,
): candidate is ChargeCurveCalibrationData {
  if (!candidate) return false;
  if (candidate.bins.length < MIN_BINS_REQUIRED) return false;
  if (candidate.soc_range_percent < MIN_SOC_RANGE_PERCENT) return false;
  return true;
}

// Blend a new candidate curve into an existing one using per-bin EWMA.
// Bins present in both curves are blended by alpha. Bins only in the candidate
// (new SOC territory) enter at ewma_weight=alpha — cautious until confirmed by
// further sessions. Bins only in the existing curve are kept unchanged.
export function blendChargeCurveBins(
  existing: ChargeCurveCalibrationData,
  candidate: ChargeCurveCalibrationData,
  alpha: number = EWMA_ALPHA,
): ChargeCurveCalibrationData {
  const binMap = new Map<number, ChargeCurveBin>();

  for (const bin of existing.bins) {
    binMap.set(bin.soc_percent, { ...bin });
  }

  for (const newBin of candidate.bins) {
    const ex = binMap.get(newBin.soc_percent);
    if (ex) {
      const existingWeight = ex.ewma_weight ?? 1.0;
      binMap.set(newBin.soc_percent, {
        soc_percent: newBin.soc_percent,
        battery_kw:
          Math.round(
            ((1 - alpha) * ex.battery_kw + alpha * newBin.battery_kw) * 1000,
          ) / 1000,
        sample_count: ex.sample_count + newBin.sample_count,
        ewma_weight: Math.min(
          1.0,
          existingWeight + alpha * (1 - existingWeight),
        ),
      });
    } else {
      binMap.set(newBin.soc_percent, { ...newBin, ewma_weight: alpha });
    }
  }

  const bins = [...binMap.values()].sort(
    (a, b) => a.soc_percent - b.soc_percent,
  );
  const minSoc = bins[0].soc_percent;
  const maxSoc = bins[bins.length - 1].soc_percent;

  return {
    bins,
    total_sample_count:
      existing.total_sample_count + candidate.total_sample_count,
    soc_range_percent: maxSoc - minSoc,
    data_window_days: candidate.data_window_days,
    built_at: new Date().toISOString(),
  };
}

export function lookupBatteryRateKw(
  soc: number,
  bins: ChargeCurveBin[],
): number {
  if (bins.length === 0) return 0;
  if (soc <= bins[0].soc_percent) return bins[0].battery_kw;
  if (soc >= bins[bins.length - 1].soc_percent)
    return bins[bins.length - 1].battery_kw;

  for (let i = 0; i < bins.length - 1; i++) {
    const lo = bins[i];
    const hi = bins[i + 1];
    if (soc >= lo.soc_percent && soc <= hi.soc_percent) {
      const t = (soc - lo.soc_percent) / (hi.soc_percent - lo.soc_percent);
      return lo.battery_kw + t * (hi.battery_kw - lo.battery_kw);
    }
  }

  return bins[bins.length - 1].battery_kw;
}
