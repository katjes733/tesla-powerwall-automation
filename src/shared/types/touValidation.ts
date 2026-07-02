import type { TouEditorState, TouSeason, TouTimeBlock } from "./tou";

export interface PeriodIssue {
  periodId: string;
  fields: ("from" | "to" | "days")[];
  message: string;
}

export interface CoverageIssue {
  view: "weekday" | "weekend";
  type: "gap" | "overlap";
  startMinute: number;
  endMinute: number;
  involvedPeriodIds: string[];
}

export interface SeasonValidation {
  periodIssues: PeriodIssue[];
  coverageIssues: CoverageIssue[];
}

export interface TouValidationResult {
  bySeasonId: Record<string, SeasonValidation>;
  monthGaps: number[];
  monthOverlaps: Array<{ month: number; seasonIds: string[] }>;
  hasErrors: boolean;
}

function formatMinute(m: number): string {
  if (m === 0 || m >= 1440) return "midnight";
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export function formatCoverageIssue(issue: CoverageIssue): string {
  const viewLabel = issue.view === "weekday" ? "Weekdays" : "Weekends";
  const start = formatMinute(issue.startMinute);
  const end = formatMinute(issue.endMinute);
  if (issue.type === "gap") {
    return `${viewLabel}: no period covers ${start}–${end}`;
  }
  return `${viewLabel}: overlapping periods ${start}–${end}`;
}

function detectCoverage(
  periods: TouTimeBlock[],
  view: "weekday" | "weekend",
): CoverageIssue[] {
  // Mirror TouTimeline's exact day filter
  const applicable = periods.filter((p) =>
    view === "weekday" ? p.toDayOfWeek <= 4 : p.toDayOfWeek >= 5,
  );

  if (applicable.length === 0) return [];

  const coverage: string[][] = Array.from({ length: 1440 }, () => []);
  for (const p of applicable) {
    const from = p.fromHour * 60 + p.fromMinute;
    const to = p.toHour * 60 + p.toMinute;
    // Mirror TouTimeline: to <= from means the period crosses midnight
    const wraps = to <= from;
    if (wraps) {
      // covers [0, to) and [from, 1440) — e.g. 0→0 fills the full day
      for (let m = 0; m < to; m++) coverage[m].push(p.id);
      for (let m = from; m < 1440; m++) coverage[m].push(p.id);
    } else {
      for (let m = from; m < to; m++) coverage[m].push(p.id);
    }
  }

  const issues: CoverageIssue[] = [];
  let gapStart: number | null = null;
  let overlapStart: number | null = null;
  let overlapIds: string[] = [];

  for (let m = 0; m <= 1440; m++) {
    const ids = m < 1440 ? coverage[m] : [];
    const count = ids.length;

    if (count === 0 && gapStart === null) {
      gapStart = m;
    } else if (count !== 0 && gapStart !== null) {
      issues.push({
        view,
        type: "gap",
        startMinute: gapStart,
        endMinute: m,
        involvedPeriodIds: [],
      });
      gapStart = null;
    }

    if (count > 1 && overlapStart === null) {
      overlapStart = m;
      overlapIds = [...new Set(ids)];
    } else if (count > 1 && overlapStart !== null) {
      for (const id of ids) if (!overlapIds.includes(id)) overlapIds.push(id);
    } else if (count <= 1 && overlapStart !== null) {
      issues.push({
        view,
        type: "overlap",
        startMinute: overlapStart,
        endMinute: m,
        involvedPeriodIds: overlapIds,
      });
      overlapStart = null;
      overlapIds = [];
    }
  }

  return issues;
}

export function validateSeason(season: TouSeason): SeasonValidation {
  const periodIssues: PeriodIssue[] = [];

  for (const p of season.periods) {
    // to <= from is a valid midnight-crossing period (matches TouTimeline semantics);
    // 0→0 in particular is Tesla's encoding for "all day". No time errors here.
    if (p.fromDayOfWeek > p.toDayOfWeek) {
      periodIssues.push({
        periodId: p.id,
        fields: ["days"],
        message: "Start day must not be after end day",
      });
    }
  }

  const coverageIssues: CoverageIssue[] =
    season.periods.length > 0
      ? [
          ...detectCoverage(season.periods, "weekday"),
          ...detectCoverage(season.periods, "weekend"),
        ]
      : [];

  return { periodIssues, coverageIssues };
}

function seasonMonths(season: TouSeason): number[] {
  const months: number[] = [];
  const { fromMonth, toMonth } = season;
  if (fromMonth <= toMonth) {
    for (let m = fromMonth; m <= toMonth; m++) months.push(m);
  } else {
    for (let m = fromMonth; m <= 12; m++) months.push(m);
    for (let m = 1; m <= toMonth; m++) months.push(m);
  }
  return months;
}

export function validateEditorState(
  state: TouEditorState,
): TouValidationResult {
  const bySeasonId: Record<string, SeasonValidation> = {};
  for (const season of state.seasons) {
    bySeasonId[season.id] = validateSeason(season);
  }

  const monthCoverage: Record<number, string[]> = {};
  for (let m = 1; m <= 12; m++) monthCoverage[m] = [];
  for (const season of state.seasons) {
    for (const m of seasonMonths(season)) {
      monthCoverage[m].push(season.id);
    }
  }

  const monthGaps = (Object.keys(monthCoverage) as unknown as number[])
    .map(Number)
    .filter((m) => monthCoverage[m].length === 0)
    .sort((a, b) => a - b);

  const monthOverlaps = (Object.keys(monthCoverage) as unknown as number[])
    .map(Number)
    .filter((m) => monthCoverage[m].length > 1)
    .sort((a, b) => a - b)
    .map((m) => ({ month: m, seasonIds: monthCoverage[m] }));

  const hasErrors =
    Object.values(bySeasonId).some(
      (sv) => sv.periodIssues.length > 0 || sv.coverageIssues.length > 0,
    ) ||
    monthGaps.length > 0 ||
    monthOverlaps.length > 0;

  return { bySeasonId, monthGaps, monthOverlaps, hasErrors };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatMonthIssues(
  result: TouValidationResult,
  state: TouEditorState,
): string[] {
  const issues: string[] = [];
  for (const m of result.monthGaps) {
    issues.push(`${MONTH_NAMES[m - 1]} is not covered by any season`);
  }
  for (const { month, seasonIds } of result.monthOverlaps) {
    const names = seasonIds
      .map((id) => state.seasons.find((s) => s.id === id)?.name ?? id)
      .join(", ");
    issues.push(
      `${MONTH_NAMES[month - 1]} is covered by multiple seasons: ${names}`,
    );
  }
  return issues;
}

export function formatValidationErrors(
  result: TouValidationResult,
  state: TouEditorState,
): string[] {
  const errors: string[] = [];

  for (const season of state.seasons) {
    const sv = result.bySeasonId[season.id];
    if (!sv) continue;

    for (const pi of sv.periodIssues) {
      const idx = season.periods.findIndex((p) => p.id === pi.periodId);
      errors.push(`${season.name} — Period ${idx + 1}: ${pi.message}`);
    }

    for (const ci of sv.coverageIssues) {
      errors.push(`${season.name} — ${formatCoverageIssue(ci)}`);
    }
  }

  for (const m of result.monthGaps) {
    errors.push(`${MONTH_NAMES[m - 1]} is not covered by any season`);
  }

  for (const { month, seasonIds } of result.monthOverlaps) {
    const names = seasonIds
      .map((id) => state.seasons.find((s) => s.id === id)?.name ?? id)
      .join(", ");
    errors.push(
      `${MONTH_NAMES[month - 1]} is covered by multiple seasons: ${names}`,
    );
  }

  return errors;
}
