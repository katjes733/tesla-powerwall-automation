import { describe, it, expect } from "vitest";
import { deriveHolidayPillStatus } from "~/server/util/holidays";
import type { ISiteHolidayStatus } from "~/server/database/models/siteHolidayStatus";

const TZ = "America/Phoenix";
const TODAY = "2026-09-07";

function statusFor(
  overrides: Partial<ISiteHolidayStatus> = {},
): ISiteHolidayStatus {
  return {
    site_id: "42",
    date: TODAY,
    action: "override",
    holiday_name: "Labor Day",
    error: null,
    checked_at: new Date("2026-09-07T07:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveHolidayPillStatus", () => {
  it("returns null when today is not a holiday, regardless of any stored status", () => {
    expect(deriveHolidayPillStatus(null, statusFor(), TODAY, TZ)).toBeNull();
  });

  it("returns 'applied' when the stored status is for today and the action succeeded", () => {
    const result = deriveHolidayPillStatus(
      "Labor Day",
      statusFor({ date: TODAY, action: "override" }),
      TODAY,
      TZ,
    );

    expect(result).toMatchObject({ name: "Labor Day", state: "applied" });
    expect(result?.detail).toContain("applied");
  });

  it("returns 'failed' with the error message when the stored status is for today and the action failed", () => {
    const result = deriveHolidayPillStatus(
      "Labor Day",
      statusFor({
        date: TODAY,
        action: "failed",
        error: "Error posting TOU settings: 500 Internal Server Error",
      }),
      TODAY,
      TZ,
    );

    expect(result).toMatchObject({ name: "Labor Day", state: "failed" });
    expect(result?.detail).toContain(
      "Error posting TOU settings: 500 Internal Server Error",
    );
  });

  it("returns 'pending' when there is no stored status at all", () => {
    const result = deriveHolidayPillStatus("Labor Day", null, TODAY, TZ);

    expect(result).toMatchObject({ name: "Labor Day", state: "pending" });
  });

  it("returns 'pending' — not a false 'applied' — when the stored status is stale (the exact 2026-09-07 failure mode: the cron never fired today)", () => {
    const result = deriveHolidayPillStatus(
      "Labor Day",
      statusFor({ date: "2026-09-06", action: "override" }),
      TODAY,
      TZ,
    );

    expect(result).toMatchObject({ name: "Labor Day", state: "pending" });
  });

  it("returns 'pending' when today's stored status is 'restore' or 'none' despite today being an active holiday (edge case, e.g. a holiday-list edit mid-day)", () => {
    const restoreResult = deriveHolidayPillStatus(
      "Labor Day",
      statusFor({ date: TODAY, action: "restore" }),
      TODAY,
      TZ,
    );
    const noneResult = deriveHolidayPillStatus(
      "Labor Day",
      statusFor({ date: TODAY, action: "none" }),
      TODAY,
      TZ,
    );

    expect(restoreResult).toMatchObject({ state: "pending" });
    expect(noneResult).toMatchObject({ state: "pending" });
  });
});
