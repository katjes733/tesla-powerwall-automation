import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be defined before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockSendEmail,
  mockRedis,
  mockGetEnergyProducts,
  mockGetActionMap,
  mockUpsertSchedule,
  mockGetAllEmails,
  mockGetAllEmailsWithExpiry,
  mockQueryBuilder,
  cronCallbacks,
  cronTaskOptions,
  cronMissedHandlers,
  cronLoggerRef,
  mockTriggerGridRate,
  mockTriggerChargeCurve,
  mockResolveNotificationRecipients,
} = vi.hoisted(() => {
  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn(async () => []),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn(async () => ({ affected: 0 })),
  };
  return {
    mockSendEmail: vi.fn(),
    mockRedis: {
      exists: vi.fn(async () => 0 as number),
      set: vi.fn(async () => "OK"),
      del: vi.fn(async () => 1),
      keys: vi.fn(async () => [] as string[]),
      expire: vi.fn(async () => 1),
    },
    mockGetEnergyProducts: vi.fn(async () => [] as unknown[]),
    mockGetActionMap: vi.fn(() => ({})),
    mockUpsertSchedule: vi.fn(async () => {}),
    mockGetAllEmails: vi.fn(async () => [] as { id: string; email: string }[]),
    mockGetAllEmailsWithExpiry: vi.fn(
      async () => [] as { id: string; email: string; expiresAt: Date }[],
    ),
    mockQueryBuilder,
    cronCallbacks: {} as Record<string, () => Promise<void>>,
    cronTaskOptions: {} as Record<string, Record<string, unknown>>,
    cronMissedHandlers: {} as Record<string, () => void>,
    cronLoggerRef: { current: null as unknown },
    mockTriggerGridRate: vi.fn(async () => {}),
    mockTriggerChargeCurve: vi.fn(async () => {}),
    // Notification-recipient resolution has its own dedicated test coverage
    // (tests/server/util/notificationRecipients.test.ts) — here it's mocked
    // wholesale (same treatment as Fleet below) so these tests stay focused
    // on scheduler logic. Defaults to "just the account owner", mirroring
    // the pre-existing unconditional-owner-email behavior these tests assert.
    mockResolveNotificationRecipients: vi.fn(async (accountEmail: string) => [
      accountEmail,
    ]),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/util/mailing", () => ({ sendEmail: mockSendEmail }));
vi.mock("~/server/util/notificationRecipients", () => ({
  resolveNotificationRecipients: mockResolveNotificationRecipients,
}));
vi.mock("~/server/util/redis", () => ({ redis: mockRedis }));
vi.mock("~/server/util/fleet", () => ({
  Fleet: {
    getInstance: vi.fn(() => ({
      getEnergyProducts: mockGetEnergyProducts,
      getActionMap: mockGetActionMap,
    })),
  },
}));
vi.mock("~/server/util/maskEmail", () => ({ maskEmail: (e: string) => e }));
vi.mock("~/server/util/routes/schedule", () => ({
  getAll: vi.fn(async () => []),
  upsert: mockUpsertSchedule,
  deleteById: vi.fn(async () => {}),
}));
vi.mock("~/server/util/routes/refreshToken", () => ({
  getAllEmails: mockGetAllEmails,
  getAllEmailsWithExpiry: mockGetAllEmailsWithExpiry,
}));
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(async () => ({
      getRepository: vi.fn(() => ({
        createQueryBuilder: vi.fn(() => mockQueryBuilder),
        findOne: vi.fn(async () => null),
        save: vi.fn(async () => {}),
      })),
    })),
  },
}));
vi.mock("~/server/database/models/siteSettings", () => ({
  resolveSiteSettings: vi.fn(() => ({ auto_curve_calibration_enabled: false })),
}));
vi.mock("~/server/util/curveFit", () => ({
  buildChargeCurveBins: vi.fn(() => ({})),
  blendChargeCurveBins: vi.fn(() => ({})),
  isValidCandidate: vi.fn(() => false),
  MAX_CURVE_START_SOC_PERCENT: 85,
}));
vi.mock("~/server/util/calibrationService", () => ({
  triggerGridChargeRateCalibration: mockTriggerGridRate,
  triggerChargeCurveCalibration: mockTriggerChargeCurve,
  CALIBRATION_SCHEDULE_ACTIONS: new Set([
    "calibrate_grid_charge_rate",
    "calibrate_charge_curve",
  ]),
}));
vi.mock("node-cron", () => ({
  schedule: vi.fn(
    (
      expr: string,
      cb: () => Promise<void>,
      options?: Record<string, unknown>,
    ) => {
      cronCallbacks[expr] = cb;
      cronTaskOptions[expr] = options ?? {};
      return {
        stop: vi.fn(),
        destroy: vi.fn(),
        getNextRun: vi.fn(() => null),
        on: vi.fn((event: string, handler: () => void) => {
          if (event === "execution:missed") {
            cronMissedHandlers[expr] = handler;
          }
        }),
      };
    },
  ),
  setLogger: vi.fn((adapter: unknown) => {
    cronLoggerRef.current = adapter;
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { Scheduler } from "~/server/util/scheduler";
import { TOKEN_STALE_THRESHOLD_MS } from "~/server/util/notificationDedup";
import { logSpy } from "../setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_MS = 1_000_000_000_000;

const BASE_SCHEDULE = {
  id: "sched-1",
  email: "owner@example.com",
  site_ids: ["42"],
  cron: "0 * * * *",
  timezone: "UTC",
  enabled: true,
  actions: [],
  conditions: [],
  expires_at: undefined as Date | undefined,
  options: null,
};

function freshScheduler() {
  (Scheduler as unknown as { instance: unknown }).instance = undefined;
  return Scheduler.getInstance();
}

// Bypasses initialize()'s DB round-trip when a test only needs
// isValidSchedule()'s refresh-token check to pass.
function withValidEmail(scheduler: Scheduler, email = "owner@example.com") {
  (
    scheduler as unknown as { validEmails: { id: string; email: string }[] }
  ).validEmails = [{ id: "u1", email }];
}

async function runEval(
  scheduler: Scheduler,
  overrides: Partial<typeof BASE_SCHEDULE> = {},
) {
  await (
    scheduler as unknown as {
      runEvaluation: (
        _s: typeof BASE_SCHEDULE,
        _m: Map<string, boolean>,
      ) => Promise<void>;
    }
  ).runEvaluation({ ...BASE_SCHEDULE, ...overrides }, new Map());
}

// ---------------------------------------------------------------------------
// runEvaluation — schedule failure email dedup
// ---------------------------------------------------------------------------

describe("runEvaluation — schedule failure email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  it("sends email to owner on first failure (Redis key absent)", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler());

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "sched_error_notified:sched-1",
      "1",
    );
  });

  it("suppresses email on repeated failure (Redis key present)", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockResolvedValue(1);

    await runEval(freshScheduler());

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("clears Redis key on success and sends no email", async () => {
    mockGetEnergyProducts.mockResolvedValue([]);

    await runEval(freshScheduler());

    expect(mockRedis.del).toHaveBeenCalledWith("sched_error_notified:sched-1");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends email again after recovery then new failure", async () => {
    const scheduler = freshScheduler();

    mockGetEnergyProducts.mockResolvedValue([]);
    await runEval(scheduler);
    expect(mockRedis.del).toHaveBeenCalledWith("sched_error_notified:sched-1");

    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockResolvedValue(0);
    await runEval(scheduler);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
  });

  it("sends email (fail-open) when Redis.exists throws", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockRejectedValueOnce(new Error("Redis down"));

    await runEval(freshScheduler());

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
  });

  it("sends email without dedup when schedule has no id", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));

    await runEval(freshScheduler(), { id: undefined as unknown as string });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockRedis.exists).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runEvaluation — schedule expiry detected mid-run
// ---------------------------------------------------------------------------

describe("runEvaluation — schedule expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  const expiredAt = new Date(Date.now() - 1000);

  it("sends expiry email to owner on first detection", async () => {
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler(), { expires_at: expiredAt });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "sched_expired_notified:sched-1",
      "1",
    );
  });

  it("suppresses expiry email when already notified", async () => {
    mockRedis.exists.mockResolvedValue(1);

    await runEval(freshScheduler(), { expires_at: expiredAt });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initializeOneSchedule — schedule expiry detected at startup
// ---------------------------------------------------------------------------

describe("initializeOneSchedule — schedule expiry at startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  const expiredAt = new Date(Date.now() - 1000);

  it("sends expiry email to owner on first detection", async () => {
    mockRedis.exists.mockResolvedValue(0);

    await freshScheduler().initializeOneSchedule({
      ...BASE_SCHEDULE,
      expires_at: expiredAt,
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "sched_expired_notified:sched-1",
      "1",
    );
  });

  it("suppresses expiry email when already notified", async () => {
    mockRedis.exists.mockResolvedValue(1);

    await freshScheduler().initializeOneSchedule({
      ...BASE_SCHEDULE,
      expires_at: expiredAt,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Token staleness daily cron
// ---------------------------------------------------------------------------

describe("token staleness cron (0 9 * * *)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  async function setupCron() {
    mockGetAllEmails.mockResolvedValue([
      { id: "u1", email: "owner@example.com" },
    ]);
    await freshScheduler().initialize();
    expect(cronCallbacks["0 9 * * *"]).toBeDefined();
  }

  it("sends stale-token email to the token owner", async () => {
    await setupCron();
    mockGetAllEmailsWithExpiry.mockResolvedValue([
      {
        id: "t1",
        email: "owner@example.com",
        expiresAt: new Date(NOW_MS - TOKEN_STALE_THRESHOLD_MS - 1),
      },
    ]);
    mockRedis.exists.mockResolvedValue(0);

    await cronCallbacks["0 9 * * *"]();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBe("owner@example.com");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "token_stale_notified:owner@example.com",
      "1",
      "EX",
      24 * 60 * 60,
    );
  });

  it("suppresses stale-token email when already notified within 24h", async () => {
    await setupCron();
    mockGetAllEmailsWithExpiry.mockResolvedValue([
      {
        id: "t1",
        email: "owner@example.com",
        expiresAt: new Date(NOW_MS - TOKEN_STALE_THRESHOLD_MS - 1),
      },
    ]);
    mockRedis.exists.mockResolvedValue(1);

    await cronCallbacks["0 9 * * *"]();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not send for a non-stale token", async () => {
    await setupCron();
    mockGetAllEmailsWithExpiry.mockResolvedValue([
      {
        id: "t1",
        email: "owner@example.com",
        expiresAt: new Date(NOW_MS + 60 * 60 * 1000),
      },
    ]);

    await cronCallbacks["0 9 * * *"]();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends to RECIPIENT_EMAIL (no recipient arg) when the job itself throws", async () => {
    await setupCron();
    mockGetAllEmailsWithExpiry.mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    await cronCallbacks["0 9 * * *"]();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][2]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runEvaluation — calibration action dispatch
// ---------------------------------------------------------------------------

// Helpers to work around narrow BASE_SCHEDULE inferred types
function withActions(actions: Array<{ action: string; value: string }>) {
  return { actions: actions as never[] };
}
function withOptions(options: Record<string, unknown> | null) {
  return { options: options as null };
}
function upsertCalls() {
  return mockUpsertSchedule.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
}

describe("runEvaluation — calibration action dispatch", () => {
  const PRODUCT = { energy_site_id: "42" };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
    mockGetEnergyProducts.mockResolvedValue([PRODUCT]);
  });

  it("dispatches calibrate_grid_charge_rate to triggerGridChargeRateCalibration", async () => {
    await runEval(
      freshScheduler(),
      withActions([{ action: "calibrate_grid_charge_rate", value: "{}" }]),
    );

    expect(mockTriggerGridRate).toHaveBeenCalledOnce();
    expect(mockTriggerGridRate).toHaveBeenCalledWith(
      "42",
      "owner@example.com",
      "sched-1",
    );
    expect(mockTriggerChargeCurve).not.toHaveBeenCalled();
  });

  it("dispatches calibrate_charge_curve to triggerChargeCurveCalibration", async () => {
    await runEval(
      freshScheduler(),
      withActions([{ action: "calibrate_charge_curve", value: "{}" }]),
    );

    expect(mockTriggerChargeCurve).toHaveBeenCalledOnce();
    expect(mockTriggerChargeCurve).toHaveBeenCalledWith(
      "42",
      "owner@example.com",
      "sched-1",
    );
    expect(mockTriggerGridRate).not.toHaveBeenCalled();
  });

  it("sends email when calibration trigger throws (conditions not met)", async () => {
    mockTriggerGridRate.mockRejectedValueOnce(
      new Error("conditions not met for site 42: SOC too high"),
    );
    mockRedis.exists.mockResolvedValue(0);

    await runEval(
      freshScheduler(),
      withActions([{ action: "calibrate_grid_charge_rate", value: "{}" }]),
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect((mockSendEmail.mock.calls as Array<unknown[]>)[0][2]).toBe(
      "owner@example.com",
    );
  });

  it("does not call fleet action map for calibration actions", async () => {
    await runEval(
      freshScheduler(),
      withActions([{ action: "calibrate_grid_charge_rate", value: "{}" }]),
    );

    expect(mockGetActionMap).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runEvaluation — runOnce cleanup
// ---------------------------------------------------------------------------

describe("runEvaluation — runOnce cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
    mockGetEnergyProducts.mockResolvedValue([]);
  });

  it("disables the schedule after a successful run when runOnce is true", async () => {
    await runEval(freshScheduler(), withOptions({ runOnce: true }));

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.id === "sched-1" && call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(1);
  });

  it("does not disable the schedule after a successful run when runOnce is false", async () => {
    await runEval(freshScheduler(), withOptions({ runOnce: false }));

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(0);
  });

  it("does not disable the schedule when options is null (default)", async () => {
    await runEval(freshScheduler(), withOptions(null));

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(0);
  });

  it("disables the schedule after a failed run when runOnce is true", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler(), withOptions({ runOnce: true }));

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.id === "sched-1" && call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(1);
  });

  it("does not disable the schedule after a failed run when runOnce is false", async () => {
    mockGetEnergyProducts.mockRejectedValueOnce(new Error("API down"));
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler(), withOptions({ runOnce: false }));

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(0);
  });

  it("disables the schedule when it expires unfired and runOnce is true", async () => {
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler(), {
      ...withOptions({ runOnce: true }),
      expires_at: new Date(Date.now() - 1000),
    });

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.id === "sched-1" && call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(1);
  });

  it("does not disable the schedule when it expires unfired and runOnce is false", async () => {
    mockRedis.exists.mockResolvedValue(0);

    await runEval(freshScheduler(), {
      ...withOptions({ runOnce: false }),
      expires_at: new Date(Date.now() - 1000),
    });

    const disableCalls = upsertCalls().filter(
      (call) => call[0]?.enabled === false,
    );
    expect(disableCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// node-cron missed-execution tolerance
//
// Regression coverage for the 2026-09-07 holiday-override incident: node-cron
// silently drops a scheduled fire (no log via the app's own Pino pipeline —
// only a raw console.warn) when the event loop is busy past its default 1000ms
// missedExecutionTolerance. Every scheduleTask() call site must opt into a
// more forgiving tolerance so a brief stall costs a late run, not a skipped
// one.
// ---------------------------------------------------------------------------

describe("node-cron missed-execution tolerance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
    Object.keys(cronTaskOptions).forEach((k) => delete cronTaskOptions[k]);
    Object.keys(cronMissedHandlers).forEach(
      (k) => delete cronMissedHandlers[k],
    );
  });

  it("applies a 30s tolerance to the internal calibration, curve-aggregation, and token-expiry tasks", async () => {
    await freshScheduler().initialize();

    expect(cronTaskOptions["* * * * *"]?.missedExecutionTolerance).toBe(30_000);
    expect(cronTaskOptions["0 */6 * * *"]?.missedExecutionTolerance).toBe(
      30_000,
    );
    expect(cronTaskOptions["0 9 * * *"]?.missedExecutionTolerance).toBe(30_000);
  });

  it("applies a 30s tolerance to a user schedule's own cron registration", async () => {
    const scheduler = freshScheduler();
    withValidEmail(scheduler);

    // isValidSchedule() requires at least one action for the task to be
    // registered at all — the action's own handler validity is irrelevant
    // here, since that's checked later at evaluation time, not registration.
    await scheduler.initializeOneSchedule({
      ...BASE_SCHEDULE,
      ...withActions([{ action: "setSmartGridCharging", value: "" }]),
    });

    expect(cronTaskOptions["0 * * * *"]).toMatchObject({
      timezone: "UTC",
      missedExecutionTolerance: 30_000,
    });
  });
});

// ---------------------------------------------------------------------------
// node-cron logger bridge
//
// node-cron's internal "missed execution" warning is otherwise invisible to
// Loki (it bypasses Pino entirely). setLogger() is called once at module load
// with an adapter forwarding into the scheduler's Pino logger — these tests
// exercise that adapter directly (captured via the node-cron mock's
// setLogger) rather than re-registering it per test.
// ---------------------------------------------------------------------------

describe("node-cron logger bridge", () => {
  function adapter() {
    return cronLoggerRef.current as {
      info: (_message: string) => void;
      warn: (_message: string) => void;
      error: (_message: string | Error, _err?: Error) => void;
      debug: (_message: string | Error, _err?: Error) => void;
    };
  }

  it("was registered with node-cron at module load", () => {
    expect(adapter()).toBeTruthy();
    expect(typeof adapter().info).toBe("function");
    expect(typeof adapter().warn).toBe("function");
    expect(typeof adapter().error).toBe("function");
    expect(typeof adapter().debug).toBe("function");
  });

  it("forwards info/warn through to the Pino scheduler logger", () => {
    adapter().info("missed execution info");
    expect(logSpy("info")).toHaveBeenCalledWith(
      { source: "node-cron" },
      "missed execution info",
    );

    adapter().warn("missed execution at 2026-09-07T07:00:00.000Z");
    expect(logSpy("warn")).toHaveBeenCalledWith(
      { source: "node-cron" },
      "missed execution at 2026-09-07T07:00:00.000Z",
    );
  });

  it("forwards a string error message plus a separate Error object", () => {
    const err = new Error("boom");
    adapter().error("Task failed with error!", err);
    expect(logSpy("error")).toHaveBeenCalledWith(
      { source: "node-cron", err },
      "Task failed with error!",
    );
  });

  it("forwards an Error passed directly as the message", () => {
    const err = new Error("boom");
    adapter().error(err);
    expect(logSpy("error")).toHaveBeenCalledWith(
      { source: "node-cron", err },
      "boom",
    );
  });

  it("does not throw for any debug call shape", () => {
    expect(() => adapter().debug("plain debug message")).not.toThrow();
    expect(() =>
      adapter().debug("debug with err", new Error("boom")),
    ).not.toThrow();
    expect(() => adapter().debug(new Error("boom"))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Holiday schedule missed-execution fallback
//
// setTouHolidayOverride owns the whole day's TOU override — unlike
// setSmartGridCharging there's no next-minute retry, so a dropped fire must
// be recovered immediately rather than losing the day.
// ---------------------------------------------------------------------------

describe("holiday schedule missed-execution fallback", () => {
  const HOLIDAY_SCHEDULE = {
    ...BASE_SCHEDULE,
    id: "holiday-sched",
    cron: "0 0 * * *",
    actions: [{ action: "setTouHolidayOverride", value: "" }],
  };

  const holidayAction = vi.fn(async () => ({
    today: "2026-09-07",
    holidayAction: "override",
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
    Object.keys(cronTaskOptions).forEach((k) => delete cronTaskOptions[k]);
    Object.keys(cronMissedHandlers).forEach(
      (k) => delete cronMissedHandlers[k],
    );
    mockGetEnergyProducts.mockResolvedValue([{ energy_site_id: "42" }]);
    mockGetActionMap.mockReturnValue({ setTouHolidayOverride: holidayAction });
  });

  it("registers an execution:missed listener for a holiday schedule", async () => {
    const scheduler = freshScheduler();
    withValidEmail(scheduler);

    await scheduler.initializeOneSchedule(HOLIDAY_SCHEDULE);

    expect(cronMissedHandlers["0 0 * * *"]).toBeDefined();
  });

  it("does not register an execution:missed listener for a non-holiday schedule", async () => {
    const scheduler = freshScheduler();
    withValidEmail(scheduler);

    await scheduler.initializeOneSchedule(BASE_SCHEDULE);

    expect(cronMissedHandlers["0 * * * *"]).toBeUndefined();
  });

  it("re-runs the holiday action when node-cron reports a missed execution", async () => {
    const scheduler = freshScheduler();
    withValidEmail(scheduler);
    await scheduler.initializeOneSchedule(HOLIDAY_SCHEDULE);
    expect(holidayAction).not.toHaveBeenCalled();

    cronMissedHandlers["0 0 * * *"]();

    await vi.waitFor(() => expect(holidayAction).toHaveBeenCalledTimes(1));
    expect(holidayAction).toHaveBeenCalledWith(
      { energy_site_id: "42" },
      "",
      HOLIDAY_SCHEDULE.conditions,
    );
  });

  it("logs a warning identifying the schedule when a fallback run is triggered", async () => {
    const scheduler = freshScheduler();
    withValidEmail(scheduler);
    await scheduler.initializeOneSchedule(HOLIDAY_SCHEDULE);

    cronMissedHandlers["0 0 * * *"]();

    await vi.waitFor(() => expect(holidayAction).toHaveBeenCalledTimes(1));
    expect(logSpy("warn")).toHaveBeenCalledWith(
      { scheduleId: "holiday-sched", email: "owner@example.com" },
      "Holiday schedule missed its cron fire — running fallback evaluation",
    );
  });
});
