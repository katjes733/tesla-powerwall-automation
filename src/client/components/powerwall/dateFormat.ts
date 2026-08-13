function localDateParts(
  date: Date,
  timeZone?: string,
): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone && { timeZone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// "Today, 6:00 PM" / "Tomorrow, 6:00 AM" / "Monday, 7:30 PM" — day-qualified
// so a time never reads as "tonight" when it's actually days out (e.g. the
// next on-peak period skipping a no-peak weekend, landing on Monday).
// Locale-aware time formatting (respects the viewer's own 12h/24h
// convention) computed in the site's own timezone, not the browser's.
export function formatDayTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const target = localDateParts(date, timeZone);
  const today = localDateParts(new Date(), timeZone);
  const dayDiff = Math.round(
    (Date.UTC(target.y, target.m - 1, target.d) -
      Date.UTC(today.y, today.m - 1, today.d)) /
      86_400_000,
  );
  const time = new Intl.DateTimeFormat(undefined, {
    ...(timeZone && { timeZone }),
    timeStyle: "short",
  }).format(date);
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  const weekday = new Intl.DateTimeFormat(undefined, {
    ...(timeZone && { timeZone }),
    weekday: "long",
  }).format(date);
  return `${weekday}, ${time}`;
}
