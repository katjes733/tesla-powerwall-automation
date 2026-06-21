import type { Moment } from "moment-timezone";
import type {
  TariffContent,
  TariffSeason,
  TouPeriod,
} from "~/server/types/common";

export function parseTariffContent(raw: unknown): TariffContent | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as TariffContent;
}

/** Tesla API places seasons directly on tariff_content; older firmware nests them under utility_rates. */
function getSeasons(
  t: TariffContent,
): Record<string, TariffSeason> | undefined {
  return t.utility_rates?.seasons ?? t.seasons;
}

/** Tesla API uses uppercase ON_PEAK; normalise to whichever key is present. */
function getOnPeakPeriods(season: TariffSeason): TouPeriod[] {
  return season.tou_periods?.on_peak ?? season.tou_periods?.ON_PEAK ?? [];
}

export function hasTouData(t: TariffContent | null): boolean {
  if (!t) return false;
  const seasons = getSeasons(t);
  if (!seasons) return false;
  return Object.values(seasons).some((s) => getOnPeakPeriods(s).length > 0);
}

export function getSeasonNames(t: TariffContent): string[] {
  return Object.keys(getSeasons(t) ?? {});
}

function isDateInSeason(season: TariffSeason, now: Moment): boolean {
  const month = now.month() + 1; // 1-12
  const day = now.date();
  const nowMD = month * 100 + day;
  const fromMD = season.fromMonth * 100 + season.fromDay;
  const toMD = season.toMonth * 100 + season.toDay;
  if (fromMD <= toMD) {
    return nowMD >= fromMD && nowMD <= toMD;
  }
  // Season crosses year boundary (e.g. Nov–Mar).
  return nowMD >= fromMD || nowMD <= toMD;
}

export function getCurrentSeason(
  t: TariffContent,
  now: Moment,
): { name: string; season: TariffSeason } | null {
  const seasons = getSeasons(t);
  if (!seasons) return null;
  for (const [name, season] of Object.entries(seasons)) {
    if (isDateInSeason(season, now)) {
      return { name, season };
    }
  }
  return null;
}

function isMomentInPeriod(period: TouPeriod, now: Moment): boolean {
  // Tesla uses ISO weekdays (0=Mon…6=Sun); Moment's isoWeekday() is 1=Mon…7=Sun.
  const dow = now.isoWeekday() - 1;
  if (dow < period.fromDayOfWeek || dow > period.toDayOfWeek) return false;
  const nowMins = now.hours() * 60 + now.minutes();
  const fromMins = period.fromHour * 60 + period.fromMinute;
  const toMins = period.toHour * 60 + period.toMinute;
  if (fromMins <= toMins) {
    return nowMins >= fromMins && nowMins < toMins;
  }
  // Period wraps midnight.
  return nowMins >= fromMins || nowMins < toMins;
}

export function isCurrentlyInPeak(t: TariffContent, now: Moment): boolean {
  const current = getCurrentSeason(t, now);
  if (!current) return false;
  return getOnPeakPeriods(current.season).some((p) => isMomentInPeriod(p, now));
}

/**
 * Returns the nearest future on_peak start moment. If we are currently in a
 * peak the current peak's start is in the past, so we skip it and return the
 * next one. Returns null when no TOU data or no upcoming peak found within 7 days.
 */
export function findNextPeakStart(
  t: TariffContent,
  now: Moment,
): Moment | null {
  const current = getCurrentSeason(t, now);
  if (!current) return null;
  const periods: TouPeriod[] = getOnPeakPeriods(current.season);
  if (periods.length === 0) return null;

  let earliest: Moment | null = null;

  for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
    // Once we already found a candidate, any start on a later day is further
    // away — no need to keep searching.
    if (earliest !== null && dayOffset > 0) break;

    const candidate = now.clone().add(dayOffset, "days");
    const dow = candidate.isoWeekday() - 1; // Tesla: 0=Mon…6=Sun

    for (const period of periods) {
      if (dow < period.fromDayOfWeek || dow > period.toDayOfWeek) continue;

      const periodStart = candidate
        .clone()
        .startOf("day")
        .add(period.fromHour, "hours")
        .add(period.fromMinute, "minutes");

      if (periodStart.isAfter(now)) {
        if (!earliest || periodStart.isBefore(earliest)) {
          earliest = periodStart;
        }
      }
    }
  }

  return earliest;
}

/**
 * Returns true if `now` falls within the [from, to) window (HH:mm strings).
 * Handles windows that wrap midnight (e.g. "22:00" to "06:00").
 * Empty/missing from or to means the window is always open.
 */
export function isWithinWindow(from: string, to: string, now: Moment): boolean {
  if (!from || !to) return true;
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const nowMins = now.hours() * 60 + now.minutes();
  const fromMins = fh * 60 + fm;
  const toMins = th * 60 + tm;
  if (fromMins <= toMins) {
    return nowMins >= fromMins && nowMins < toMins;
  }
  // Wraps midnight.
  return nowMins >= fromMins || nowMins < toMins;
}
