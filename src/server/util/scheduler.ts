import type { ScheduledTask } from "node-cron";
import { schedule as scheduleTask } from "node-cron";
import moment from "moment-timezone";
import CronExpressionParser from "cron-parser";
import type {
  ISchedule,
  IScheduleAction,
  IScheduleCondition,
} from "~/server/database/models/schedule";
import { resolveScheduleOptions } from "~/server/database/models/schedule";
import type { LiveStatus } from "~/server/types/common";
import type { IBasicEntity } from "~/server/types/common";
import {
  getAllEmails as getAllEmailsFromDb,
  getAllEmailsWithExpiry as getAllEmailsWithExpiryFromDb,
} from "~/server/util/routes/refreshToken";
import {
  getAll as getAllSchedulesFromDb,
  upsert as upsertScheduleInDb,
  deleteById as deleteScheduleFromDb,
} from "~/server/util/routes/schedule";
import { sendEmail } from "./mailing";
import { Fleet, type SmartChargingData } from "~/server/util/fleet";
import { redis } from "~/server/util/redis";
import {
  isTokenStale,
  notifyOnce,
  clearNotification,
} from "./notificationDedup";
import { maskEmail } from "~/server/util/maskEmail";
import AppDataSource from "~/server/database/datasource";
import type { ISiteCalibration } from "~/server/database/models/siteCalibration";
import type { ISiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import type { ISiteSettings } from "~/server/database/models/siteSettings";
import { resolveSiteSettings } from "~/server/database/models/siteSettings";
import {
  buildChargeCurveBins,
  blendChargeCurveBins,
  isValidCandidate,
  type ChargeCurveCalibrationData,
} from "~/server/util/curveFit";

const schedulerLog = logger.child({ service: "scheduler" });

async function evaluateConditions(
  conditions: IScheduleCondition[],
  liveStatus: LiveStatus,
  timezone: string,
  fleet: Fleet,
  product: { energy_site_id: number; site_name: string },
): Promise<boolean> {
  const primary = conditions.find((c) => c.condition !== "betweenHours");
  const timeWindow = conditions.find((c) => c.condition === "betweenHours");

  if (!primary) {
    schedulerLog.warn(
      { siteId: String(product.energy_site_id), siteName: product.site_name },
      'Schedule has only a "betweenHours" condition with no primary condition — treating as always-pass',
    );
    return true;
  }

  if (timeWindow) {
    const { from, to } = timeWindow.value as { from: string; to: string };
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const now = moment().tz(timezone);
    const nowMin = now.hours() * 60 + now.minutes();
    const fromMin = fh * 60 + fm;
    const toMin = th * 60 + tm;
    const inWindow =
      toMin > fromMin
        ? nowMin >= fromMin && nowMin < toMin
        : nowMin >= fromMin || nowMin < toMin;
    if (!inWindow) return false;
  }

  switch (primary.condition) {
    case "charged":
      return liveStatus.percentage_charged >= (primary.value as number);
    case "discharged":
      return liveStatus.percentage_charged <= (primary.value as number);
    case "backup": {
      const siteInfo = await fleet.getSiteInfo(product as any);
      if (!siteInfo) {
        schedulerLog.warn(
          {
            siteId: String(product.energy_site_id),
            siteName: product.site_name,
          },
          'Cannot evaluate "backup" condition — site info unavailable',
        );
        return false;
      }
      return liveStatus.percentage_charged <= siteInfo.backup_reserve_percent;
    }
    case "homeUsageAbove":
      return liveStatus.load_power / 1000 > (primary.value as number);
    case "homeUsageBelow":
      return liveStatus.load_power / 1000 <= (primary.value as number);
    case "solarGenerationAbove":
      return liveStatus.solar_power / 1000 > (primary.value as number);
    case "solarGenerationBelow":
      return liveStatus.solar_power / 1000 <= (primary.value as number);
    case "gridImportAbove":
      return liveStatus.grid_power / 1000 > (primary.value as number);
    case "gridImportBelow":
      return liveStatus.grid_power / 1000 <= (primary.value as number);
    case "gridExportAbove":
      return -liveStatus.grid_power / 1000 > (primary.value as number);
    case "gridExportBelow":
      return -liveStatus.grid_power / 1000 <= (primary.value as number);
    default:
      schedulerLog.warn(
        {
          siteId: String(product.energy_site_id),
          siteName: product.site_name,
          condition: primary.condition,
        },
        "Unknown condition — treating as passed",
      );
      return true;
  }
}

function isTickBased(cron: string): boolean {
  try {
    const interval = CronExpressionParser.parse(cron);
    const t1 = interval.next().toDate().getTime();
    const t2 = interval.next().toDate().getTime();
    return t2 - t1 <= 60_000;
  } catch {
    return false;
  }
}

export class Scheduler {
  private static instance: Scheduler;

  private enabledScheduledTasks: Map<string, ScheduledTask> = new Map();
  private calibrationTask: ScheduledTask | null = null;
  private curveCronTask: ScheduledTask | null = null;
  private tokenExpiryTask: ScheduledTask | null = null;
  private validEmails: { id: string; email: string }[] = [];
  private schedulingEnabled: boolean = true;

  private constructor() {}

  public static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  private isValidSchedule(schedule: ISchedule): boolean {
    const schedLog = schedulerLog.child({
      scheduleId: schedule.id,
      email: maskEmail(schedule.email),
    });
    if (!this.validEmails.some(({ email }) => email === schedule.email)) {
      schedLog.warn("Schedule has no corresponding refresh token");
      return false;
    }
    if (!schedule.enabled) {
      schedLog.info("Schedule is disabled");
      return false;
    }
    if (schedule.expires_at && new Date(schedule.expires_at) < new Date()) {
      schedLog.warn("Schedule has expired");
      return false;
    }
    if (!schedule.actions || schedule.actions.length === 0) {
      schedLog.warn("Schedule has no actions defined");
      return false;
    }
    return true;
  }

  private isValidConfigurationItem(
    config: IScheduleAction,
    schedule: ISchedule,
  ): boolean {
    const schedLog = schedulerLog.child({
      scheduleId: schedule.id,
      email: maskEmail(schedule.email),
    });
    if (!config.action || config.value == null) {
      schedLog.warn({ config }, "Invalid schedule action configuration");
      return false;
    }
    if (!Fleet.getInstance(schedule.email).getActionMap()[config.action]) {
      schedLog.warn(
        { action: config.action },
        "No handler defined for schedule action — skipping",
      );
      return false;
    }
    return true;
  }

  private async runEvaluation(
    schedule: ISchedule,
    triggeredPerProduct: Map<string, boolean>,
  ): Promise<void> {
    const now = moment().tz(schedule.timezone);
    const task = this.enabledScheduledTasks.get(schedule.id ?? "");
    const isDryRun = process.env.DRY_RUN === "true";
    const schedLog = schedulerLog.child({
      scheduleId: schedule.id,
      email: maskEmail(schedule.email),
    });

    if (schedule.expires_at && now.isAfter(moment(schedule.expires_at))) {
      schedLog.warn("Schedule has expired during evaluation");
      this.enabledScheduledTasks.delete(schedule.id || "");
      task?.destroy();
      if (schedule.id) {
        await notifyOnce(
          `sched_expired_notified:${schedule.id}`,
          () =>
            sendEmail(
              "Powerwall Notification",
              `[${new Date().toLocaleString()}] Your schedule has expired and will no longer run.`,
              schedule.email,
            ),
          redis,
        );
      }
      return;
    }

    schedLog.info(
      isDryRun ? { dryRun: true } : {},
      isDryRun
        ? "[DRY RUN] Evaluating schedule — no writes will be made"
        : "Executing schedule",
    );

    try {
      const siteIds = schedule.site_ids;
      const products = await Fleet.getInstance(schedule.email)
        .getEnergyProducts()
        .then((all) =>
          all.filter((p) => siteIds.includes(String(p.energy_site_id))),
        );

      const hasConditions =
        schedule.conditions && schedule.conditions.length > 0;
      // Smart schedules run on every tick and pass conditions to the action
      // as context rather than using them to gate execution.
      const isSmartSchedule = (schedule.actions ?? []).some(
        (a) => a.action === "setSmartGridCharging",
      );
      // Holiday schedules also bypass the rising-edge trigger and own their
      // today/yesterday logic internally.
      const isHolidaySchedule = (schedule.actions ?? []).some(
        (a) => a.action === "setTouHolidayOverride",
      );
      let actionsExecuted = 0;

      for (const product of products) {
        const siteSchedLog = schedLog.child({
          siteId: String(product.energy_site_id),
          siteName: product.site_name,
        });

        if (hasConditions && !isSmartSchedule && !isHolidaySchedule) {
          const liveStatus = await Fleet.getInstance(
            schedule.email,
          ).getLiveStatus(product);
          if (!liveStatus) {
            siteSchedLog.warn(
              "Cannot evaluate conditions — live status unavailable",
            );
            continue;
          }

          const conditionMet = await evaluateConditions(
            schedule.conditions!,
            liveStatus,
            schedule.timezone,
            Fleet.getInstance(schedule.email),
            product,
          );
          const wasTriggered = triggeredPerProduct.get(product.id) ?? false;

          if (!conditionMet) {
            if (wasTriggered) {
              siteSchedLog.info("Condition cleared — resetting trigger");
              triggeredPerProduct.set(product.id, false);
            }
            continue;
          }

          if (wasTriggered) {
            if (isDryRun) {
              siteSchedLog.info(
                { dryRun: true },
                "[DRY RUN] Condition still met — skipping (already triggered)",
              );
            }
            continue;
          }

          triggeredPerProduct.set(product.id, true);
          siteSchedLog.info("Condition met — firing actions");
        }

        let actionIndex = 0;
        for (const config of schedule.actions || []) {
          if (!this.isValidConfigurationItem(config, schedule)) {
            continue;
          }
          /* eslint-disable no-unexpected-multiline */
          const result = await Fleet.getInstance(schedule.email)
            .getActionMap()
            [config.action](product, config.value, schedule.conditions ?? []);
          /* eslint-enable no-unexpected-multiline */
          if (result != null) {
            siteSchedLog.info(
              {
                scheduleAction: config.action,
                actionIndex,
                data: result as SmartChargingData,
                ...(isDryRun && { dryRun: true }),
              },
              isDryRun ? "[DRY RUN] Action result" : "Action result",
            );
          }
          actionIndex++;
          actionsExecuted++;
        }

        siteSchedLog.info(
          { actionsExecuted, ...(isDryRun && { dryRun: true }) },
          isDryRun
            ? "[DRY RUN] Schedule evaluation complete"
            : "Schedule executed",
        );
      }

      if (schedule.id) {
        await clearNotification(`sched_error_notified:${schedule.id}`, redis);
        upsertScheduleInDb({
          id: schedule.id,
          lastRunTime: now.toDate(),
          nextRunTime: task?.getNextRun() || undefined,
          ...(process.env.DRY_RUN !== "true" && {
            lastSuccessTime: now.toDate(),
          }),
        });
      }
    } catch (error: any) {
      const lastError = error.message || "Unknown error";
      schedLog.error({ err: error }, "Error executing schedule");
      const redisKey = schedule.id
        ? `sched_error_notified:${schedule.id}`
        : null;
      if (redisKey) {
        await notifyOnce(
          redisKey,
          () =>
            sendEmail(
              "Powerwall Notification",
              `[${new Date().toLocaleString()}] ${lastError}`,
              schedule.email,
            ),
          redis,
        );
      } else {
        sendEmail(
          "Powerwall Notification",
          `[${new Date().toLocaleString()}] ${lastError}`,
          schedule.email,
        );
      }
      if (schedule.id) {
        upsertScheduleInDb({
          id: schedule.id,
          lastRunTime: now.toDate(),
          nextRunTime: task?.getNextRun() || undefined,
          lastError,
          lastErrorTime: now.toDate(),
        });
      }
    }
  }

  private async maybeRecoverSchedule(schedule: ISchedule): Promise<void> {
    const options = resolveScheduleOptions(schedule.options);
    if (options.recovery !== "on_restart") return;
    if (isTickBased(schedule.cron)) return;

    const schedLog = schedulerLog.child({
      scheduleId: schedule.id,
      email: maskEmail(schedule.email),
    });
    try {
      const interval = CronExpressionParser.parse(schedule.cron, {
        tz: schedule.timezone,
        currentDate: new Date(),
      });
      const lastExpectedFire = interval.prev().toDate();
      const lastRun = schedule.last_run_time;

      if (lastRun && new Date(lastRun) >= lastExpectedFire) {
        schedLog.info(
          "Schedule already ran after last expected fire — no recovery needed",
        );
        return;
      }

      schedLog.info(
        {
          lastExpectedFire: lastExpectedFire.toISOString(),
          lastRun: lastRun ? new Date(lastRun).toISOString() : null,
        },
        "Recovering missed schedule run",
      );
      await this.runEvaluation(schedule, new Map());
    } catch (err: any) {
      schedLog.error({ err }, "Recovery check failed");
    }
  }

  async initializeOneSchedule(schedule: ISchedule) {
    if (schedule.expires_at && new Date(schedule.expires_at) < new Date()) {
      if (schedule.id) {
        await notifyOnce(
          `sched_expired_notified:${schedule.id}`,
          () =>
            sendEmail(
              "Powerwall Notification",
              `[${new Date().toLocaleString()}] Your schedule has expired and will no longer run.`,
              schedule.email,
            ),
          redis,
        );
      }
    }
    if (!this.isValidSchedule(schedule)) {
      return;
    }
    const triggeredPerProduct = new Map<string, boolean>();
    const task = scheduleTask(
      schedule.cron,
      () => this.runEvaluation(schedule, triggeredPerProduct),
      { timezone: schedule.timezone },
    );
    schedulerLog.info(
      {
        scheduleId: schedule.id,
        email: maskEmail(schedule.email),
        cron: schedule.cron,
        timezone: schedule.timezone,
        nextRun: task.getNextRun()?.toISOString() ?? null,
      },
      "Schedule registered",
    );
    this.enabledScheduledTasks.set(schedule.id || "", task);
    await this.maybeRecoverSchedule(schedule);
  }

  async initialize(schedulingEnabled = true) {
    this.schedulingEnabled = schedulingEnabled;
    this.validEmails = await getAllEmailsFromDb();
    schedulerLog.info(
      {
        count: this.validEmails.length,
        users: this.validEmails.map(({ id, email }) => ({
          userId: id,
          email: maskEmail(email),
        })),
      },
      "Valid emails loaded for scheduling",
    );
    if (!this.schedulingEnabled) {
      schedulerLog.info(
        "Scheduling is disabled — no tasks will be initialized",
      );
      return;
    }
    schedulerLog.info("Initializing scheduled tasks");
    this.enabledScheduledTasks.clear();
    const schedules = await getAllSchedulesFromDb();
    schedulerLog.info(
      { count: schedules.length },
      "Schedules found in database",
    );
    for (const schedule of schedules) {
      await this.initializeOneSchedule(schedule);
    }

    // Internal task — not user-configurable, tick-rate, no recovery mechanism.
    this.calibrationTask?.stop();
    this.calibrationTask = scheduleTask("* * * * *", async () => {
      for (const { email } of this.validEmails) {
        try {
          const fleet = Fleet.getInstance(email, {
            throwOnError: false,
            mailOnError: true,
          });
          const products = await fleet.getEnergyProducts();
          for (const product of products) {
            await fleet.detectCalibration(product);
          }
        } catch (err: any) {
          schedulerLog.error(
            { err, email: maskEmail(email) },
            "Calibration check failed",
          );
        }
      }
    });
    schedulerLog.info("Calibration detection task initialized");

    // Internal task — not user-configurable, idempotent at 6-hour granularity, no recovery mechanism.
    this.curveCronTask?.stop();
    this.curveCronTask = scheduleTask("0 */6 * * *", async () => {
      schedulerLog.info(
        "Running charge curve aggregation and sample purge job",
      );
      try {
        const db = await AppDataSource.getInstance(true);
        const sampleRepo = db.getRepository<
          IBasicEntity & ISiteCalibrationSample
        >("SiteCalibrationSample");
        const calibRepo = db.getRepository<ISiteCalibration & IBasicEntity>(
          "SiteCalibration",
        );

        const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
        const rawGroups = await sampleRepo
          .createQueryBuilder("s")
          .select("s.site_id", "site_id")
          .where("s.creation_time >= :cutoff", { cutoff })
          .groupBy("s.site_id")
          .getRawMany<{ site_id: string }>();

        const settingsRepo = db.getRepository<IBasicEntity & ISiteSettings>(
          "SiteSettings",
        );

        for (const { site_id } of rawGroups) {
          try {
            const settingsRecord = await settingsRepo.findOne({
              where: { site_id },
            });
            const siteSettings = resolveSiteSettings(
              settingsRecord?.settings ?? null,
            );
            if (!siteSettings.auto_curve_calibration_enabled) {
              schedulerLog.info(
                { siteId: site_id },
                "Curve aggregation skipped — auto calibration disabled for site",
              );
              continue;
            }

            const existing = await calibRepo.findOne({
              where: { site_id, calibration_type: "chargeCurve" },
              order: { creation_time: "DESC" },
            });
            const existingData = existing
              ? (existing.calibration_data as unknown as ChargeCurveCalibrationData)
              : null;

            // Fetch only samples recorded after the last curve update so each
            // batch is blended exactly once. Fall back to the full retention
            // window when no curve exists yet (first-ever build).
            const since = existing
              ? new Date(existing.creation_time as unknown as string)
              : cutoff;

            const samples = (await sampleRepo
              .createQueryBuilder("s")
              .where(
                "s.site_id = :site_id AND s.calibration_type = :type AND s.creation_time > :since",
                { site_id, type: "chargeCurve", since },
              )
              .orderBy("s.creation_time", "ASC")
              .getMany()) as Array<IBasicEntity & ISiteCalibrationSample>;

            if (samples.length === 0) continue;

            const candidate = buildChargeCurveBins(samples);
            if (!isValidCandidate(candidate)) continue;

            const updated = existingData
              ? blendChargeCurveBins(existingData, candidate)
              : candidate;

            const now = new Date();
            await calibRepo.save({
              site_id,
              calibration_type: "chargeCurve",
              calibration_data: updated as unknown as Record<string, unknown>,
              creation_time: now,
              modified_time: now,
            });
            schedulerLog.info(
              {
                siteId: site_id,
                bins: updated.bins.length,
                blended: existingData !== null,
              },
              "Curve aggregation: charge curve updated",
            );
          } catch (err: any) {
            schedulerLog.error(
              { err, siteId: site_id },
              "Curve aggregation failed for site",
            );
          }
        }

        const { affected } = await sampleRepo
          .createQueryBuilder()
          .delete()
          .where("creation_time < :cutoff", { cutoff })
          .execute();
        if (affected && affected > 0) {
          schedulerLog.info(
            { affected },
            "Curve aggregation: purged expired calibration samples",
          );
        }
      } catch (err: any) {
        schedulerLog.error(
          { err },
          "Charge curve aggregation and sample purge job failed",
        );
      }
    });
    schedulerLog.info(
      "Charge curve aggregation and sample purge task initialized (every 6 hours)",
    );

    // Daily check: warn if any user's stored access token has gone stale
    // (expired for >2 hours without being refreshed), which can indicate
    // that automatic token renewal is broken.
    this.tokenExpiryTask?.stop();
    this.tokenExpiryTask = scheduleTask("0 9 * * *", async () => {
      try {
        const tokens = await getAllEmailsWithExpiryFromDb();
        for (const { email, expiresAt } of tokens) {
          if (expiresAt && isTokenStale(expiresAt)) {
            const notifKey = `token_stale_notified:${email}`;
            const alreadyNotified = await redis.exists(notifKey).catch(() => 1);
            if (!alreadyNotified) {
              sendEmail(
                "Powerwall Notification",
                `[${new Date().toLocaleString()}] The Tesla access token for ${email} has not been refreshed since ${expiresAt.toLocaleString()}. Schedules for this account may be failing. Please check the server logs or re-authenticate if necessary.`,
                email,
              );
              await redis
                .set(notifKey, "1", "EX", 24 * 60 * 60)
                .catch(() => {});
            }
          }
        }
      } catch (err: any) {
        schedulerLog.error({ err }, "Token staleness check failed");
      }
    });
    schedulerLog.info(
      "Token staleness check task initialized (daily at 09:00)",
    );
  }

  async stopAll() {
    for (const [id, task] of this.enabledScheduledTasks.entries()) {
      schedulerLog.info({ scheduleId: id }, "Stopping scheduled task");
      task.stop();
      this.enabledScheduledTasks.delete(id);
    }
    this.calibrationTask?.stop();
    this.calibrationTask = null;
    this.curveCronTask?.stop();
    this.curveCronTask = null;
    this.tokenExpiryTask?.stop();
    this.tokenExpiryTask = null;
    schedulerLog.info("All scheduled tasks stopped");
  }

  async startAll() {
    for (const [id, task] of this.enabledScheduledTasks.entries()) {
      schedulerLog.info({ scheduleId: id }, "Starting scheduled task");
      task.start();
    }
    schedulerLog.info("All scheduled tasks started");
  }

  async upsert(schedule: ISchedule) {
    const schedLog = schedulerLog.child({
      scheduleId: schedule.id,
      email: maskEmail(schedule.email),
    });
    if (!this.validEmails.some(({ email }) => email === schedule.email)) {
      schedLog.warn("Schedule has no corresponding refresh token");
      return;
    }
    const existingTask = this.enabledScheduledTasks.get(schedule.id || "");
    if (existingTask) {
      schedLog.info("Updating existing scheduled task");
      existingTask.stop();
      this.enabledScheduledTasks.delete(schedule.id || "");
    }
    const result = await upsertScheduleInDb({
      id: schedule.id,
      email: schedule.email,
      siteIds: schedule.site_ids,
      cron: schedule.cron,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      expiresAt: schedule.expires_at,
      conditions: schedule.conditions,
      actions: schedule.actions,
      options: schedule.options,
    });
    schedule.id = result?.data?.id ?? schedule.id;
    if (this.schedulingEnabled && this.isValidSchedule(schedule)) {
      await this.initializeOneSchedule(schedule);
      // Holiday schedules evaluate immediately on save so same-day changes take
      // effect without waiting for the midnight cron.
      if (
        (schedule.actions ?? []).some(
          (a) => a.action === "setTouHolidayOverride",
        )
      ) {
        this.runEvaluation(schedule, new Map()).catch((err: any) =>
          schedulerLog.error(
            { err, scheduleId: schedule.id },
            "Immediate holiday evaluation failed",
          ),
        );
      }
    }
    return result;
  }

  async delete(scheduleId: string) {
    const task = this.enabledScheduledTasks.get(scheduleId);
    if (task) {
      schedulerLog.info({ scheduleId }, "Deleting scheduled task");
      task.stop();
      this.enabledScheduledTasks.delete(scheduleId);
    }
    return deleteScheduleFromDb(scheduleId);
  }
}
