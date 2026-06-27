import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import type { IBasicEntity } from "~/server/types/common";

export interface ChargeCurveBin {
  soc_percent: number;
  battery_kw: number;
  sample_count: number;
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
