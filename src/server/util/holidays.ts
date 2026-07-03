import type { HolidayEntry } from "~/server/database/models/schedule";

const DAY_OF_WEEK: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
};

const ORDINAL_VALUE: Record<string, number | "last"> = {
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  last: "last",
};

function isFixedDateFormat(date: string): boolean {
  return /^\d{2}-\d{2}$/.test(date);
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function applyObservance(d: Date): Date {
  const dow = d.getDay();
  if (dow === 6) {
    // Saturday → Friday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  }
  if (dow === 0) {
    // Sunday → Monday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return d;
}

function computeFloatingDate(
  ordinal: number | "last",
  dow: number,
  month: number,
  year: number,
): Date {
  if (ordinal === "last") {
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const lastDay = new Date(year, month - 1, lastDayOfMonth);
    const diff = (lastDay.getDay() - dow + 7) % 7;
    return new Date(year, month - 1, lastDayOfMonth - diff);
  }
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysToFirst = (dow - firstOfMonth.getDay() + 7) % 7;
  const nthDay = 1 + daysToFirst + (ordinal - 1) * 7;
  return new Date(year, month - 1, nthDay);
}

/**
 * Returns the observed date (YYYY-MM-DD) for a HolidayEntry in the given year.
 *
 * Fixed dates ("MM-DD"): observance="auto" shifts Sat→Fri and Sun→Mon.
 * Floating dates (ordinal descriptors): computed from day-of-week arithmetic;
 * observance is ignored because floating holidays always land on a weekday.
 */
export function computeObservedDate(entry: HolidayEntry, year: number): string {
  if (isFixedDateFormat(entry.date)) {
    const [mm, dd] = entry.date.split("-").map(Number);
    let d = new Date(year, mm - 1, dd);
    if (entry.observance === "auto") {
      d = applyObservance(d);
    }
    return toDateString(d);
  }

  const match = /^(1st|2nd|3rd|4th|last)(Mon|Tue|Wed|Thu|Fri)(\d{2})$/.exec(
    entry.date,
  );
  if (!match) {
    throw new Error(`Invalid holiday date descriptor: "${entry.date}"`);
  }
  const [, ordStr, dowStr, mmStr] = match;
  const ordinal = ORDINAL_VALUE[ordStr];
  const dow = DAY_OF_WEEK[dowStr];
  const month = parseInt(mmStr, 10);
  return toDateString(computeFloatingDate(ordinal, dow, month, year));
}

/**
 * Returns true if any enabled entry's observed date for the given year equals dateStr.
 * dateStr is expected to be in YYYY-MM-DD format.
 */
export function isObservedHolidayOnDate(
  entries: HolidayEntry[],
  dateStr: string,
): boolean {
  const year = parseInt(dateStr.slice(0, 4), 10);
  return entries
    .filter((e) => e.enabled)
    .some((e) => {
      try {
        return computeObservedDate(e, year) === dateStr;
      } catch {
        return false;
      }
    });
}

/**
 * Returns the name of the first enabled holiday whose observed date matches dateStr,
 * or null if no holiday falls on that date.
 * dateStr is expected to be in YYYY-MM-DD format.
 */
export function getActiveHolidayName(
  entries: HolidayEntry[],
  dateStr: string,
): string | null {
  const year = parseInt(dateStr.slice(0, 4), 10);
  for (const e of entries) {
    if (!e.enabled) continue;
    try {
      if (computeObservedDate(e, year) === dateStr) return e.name;
    } catch {
      // ignore malformed entries
    }
  }
  return null;
}

/**
 * Returns pre-built holiday templates for a given source key.
 * Pure function — no server call needed.
 */
export function generateHolidayTemplates(source: string): HolidayEntry[] {
  switch (source) {
    case "US_MAJOR":
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Memorial Day",
          date: "lastMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Independence Day",
          date: "07-04",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Labor Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "4thThu11",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    case "US_FEDERAL_ALL":
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Martin Luther King Jr. Day",
          date: "3rdMon01",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Presidents' Day",
          date: "3rdMon02",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Memorial Day",
          date: "lastMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Juneteenth National Independence Day",
          date: "06-19",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Independence Day",
          date: "07-04",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Labor Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Columbus Day",
          date: "2ndMon10",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Veterans Day",
          date: "11-11",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "4thThu11",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    case "CA_FEDERAL":
      // Note: Good Friday / Easter Monday are Easter-dependent and cannot be expressed
      // as a fixed ordinal rule — add them manually if needed.
      // Victoria Day is the Monday on or before May 24; "3rdMon05" is correct in most years.
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Victoria Day",
          date: "3rdMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Canada Day",
          date: "07-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Civic Holiday",
          date: "1stMon08",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Labour Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "National Day for Truth and Reconciliation",
          date: "09-30",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "2ndMon10",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Remembrance Day",
          date: "11-11",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Boxing Day",
          date: "12-26",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    default:
      return [];
  }
}
