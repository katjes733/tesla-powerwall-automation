import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindOne = vi.fn();
const mockQuery = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({ findOne: mockUserFindOne }),
      query: mockQuery,
    }),
  },
  qualifiedTable: (table: string) => table,
}));

import { resolveNotificationRecipients } from "~/server/util/notificationRecipients";

function grant(overrides: Record<string, unknown> = {}) {
  return {
    tesla_account_email: "owner@example.com",
    profile: "write",
    site_ids: ["site-1"],
    status: "active",
    granted_by: "owner@example.com",
    creation_time: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function delegateRow(
  email: string,
  grants: Record<string, unknown>[],
  notificationPreferences: Record<string, unknown> | null,
) {
  return {
    email,
    user_permissions: { delegations: grants },
    user_details: notificationPreferences
      ? { notification_preferences: notificationPreferences }
      : null,
  };
}

beforeEach(() => {
  // mockReset (not clearAllMocks) so a leftover queued mockResolvedValueOnce
  // from a prior test can never leak into the next one's first call.
  mockUserFindOne.mockReset().mockResolvedValue(null); // owner: no stored prefs -> default "*"
  mockQuery.mockReset().mockResolvedValue([]); // no delegates by default
});

describe("resolveNotificationRecipients — owner", () => {
  it("includes the owner by default (site-scoped type)", async () => {
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual(["owner@example.com"]);
  });

  it("excludes the owner after an explicit opt-out", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual([]);
  });

  it("includes the owner by default for account-wide types", async () => {
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      null,
      "account_health",
    );
    expect(recipients).toEqual(["owner@example.com"]);
  });
});

describe("resolveNotificationRecipients — delegates", () => {
  it("excludes a delegate by default (opted out)", async () => {
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate@example.com", [grant()], null),
    ]);
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    }); // owner opted out too, isolate delegate behavior
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual([]);
  });

  it("includes an opted-in active write delegate scoped to the site", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate@example.com", [grant()], {
        calibration_events: ["site-1"],
      }),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual(["delegate@example.com"]);
  });

  it("excludes an opted-in delegate whose grant is revoked", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate@example.com", [grant({ status: "revoked" })], {
        calibration_events: ["site-1"],
      }),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual([]);
  });

  it("excludes an opted-in delegate whose grant is now read-profile (downgrade regression)", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate@example.com", [grant({ profile: "read" })], {
        calibration_events: ["site-1"],
      }),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual([]);
  });

  it("excludes an opted-in-via-'*' delegate whose current site scope no longer overlaps", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow(
        "delegate@example.com",
        [grant({ site_ids: ["site-2"] })], // narrowed away from site-1 after opting in
        { calibration_events: "*" },
      ),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients).toEqual([]);
  });

  it("includes a delegate for a multi-site event when their scope overlaps only one site", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { schedule_issues: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate@example.com", [grant({ site_ids: ["site-2"] })], {
        schedule_issues: ["site-2"],
      }),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1", "site-2"],
      "schedule_issues",
    );
    expect(recipients).toEqual(["delegate@example.com"]);
  });

  it("ignores site scope entirely for account-wide types", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { account_health: [] } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow(
        "delegate@example.com",
        [grant({ site_ids: ["site-2"] })], // no overlap with the event, irrelevant for account-wide
        { account_health: "*" },
      ),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      null,
      "account_health",
    );
    expect(recipients).toEqual(["delegate@example.com"]);
  });

  it("includes multiple qualifying recipients with no duplicates", async () => {
    mockUserFindOne.mockResolvedValueOnce({
      user_details: { notification_preferences: { calibration_events: "*" } },
    });
    mockQuery.mockResolvedValueOnce([
      delegateRow("delegate-a@example.com", [grant()], {
        calibration_events: ["site-1"],
      }),
      delegateRow("delegate-b@example.com", [grant()], {
        calibration_events: "*",
      }),
    ]);
    const recipients = await resolveNotificationRecipients(
      "owner@example.com",
      ["site-1"],
      "calibration_events",
    );
    expect(recipients.sort()).toEqual([
      "delegate-a@example.com",
      "delegate-b@example.com",
      "owner@example.com",
    ]);
  });
});
