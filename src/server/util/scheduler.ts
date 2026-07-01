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
import { getAllEmails as getAllEmailsFromDb } from "~/server/util/routes/refreshToken";
import {
  getAll as getAllSchedulesFromDb,
  upsert as upsertScheduleInDb,
  deleteById as deleteScheduleFromDb,
} from "~/server/util/routes/schedule";
import { sendEmail } from "./mailing";
import { Fleet, type SmartChargingLogResult } from "~/server/util/fleet";
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
    logger.warn(
      `Schedule has only a "betweenHours" condition with no primary condition — treating as always-pass`,
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
        logger.warn(
          `Cannot evaluate "backup" condition for site "${product.site_name}" — site info unavailable`,
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
      logger.warn(
        `Unknown condition "${primary.condition}" — treating as passed`,
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
    if (!this.validEmails.some(({ email }) => email === schedule.email)) {
      logger.warn(
        `Schedule for email ${maskEmail(schedule.email)} has no corresponding refresh token.`,
      );
      return false; // For now, just skip this schedule. Will re-think later.
    }
    if (!schedule.enabled) {
      logger.info(`Schedule with ID ${schedule.id} is disabled.`);
      return false;
    }
    if (schedule.expires_at && new Date(schedule.expires_at) < new Date()) {
      logger.warn(`Schedule with ID ${schedule.id} has expired.`);
      return false;
    }
    if (!schedule.actions || schedule.actions.length === 0) {
      logger.warn(`Schedule with ID ${schedule.id} has no actions defined.`);
      return false; // For now, just skip this schedule. Will re-think later if we should allow empty configs at all.
    }
    return true;
  }

  private isValidConfigurationItem(
    config: IScheduleAction,
    schedule: ISchedule,
  ): boolean {
    if (!config.action || config.value == null) {
      logger.warn(
        `Invalid configuration for schedule ID ${schedule.id}: ${JSON.stringify(config)}`,
      );
      return false;
    }
    if (!Fleet.getInstance(schedule.email).getActionMap()[config.action]) {
      logger.warn(
        `There is no action defined for ${config.action} in schedule ID ${schedule.id}. Skipping...`,
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

    if (schedule.expires_at && now.isAfter(moment(schedule.expires_at))) {
      logger.warn(`Schedule with ID ${schedule.id} has expired.`);
      this.enabledScheduledTasks.delete(schedule.id || "");
      task?.destroy();
      return;
    }

    if (process.env.DRY_RUN === "true") {
      logger.info(
        `[DRY RUN] Evaluating scheduled task ${schedule.id} for ${maskEmail(schedule.email)} — no writes will be made`,
      );
    } else {
      logger.info(
        `Executing scheduled task ${schedule.id} for ${maskEmail(schedule.email)}`,
      );
    }

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
      const smartChargingResults: SmartChargingLogResult[] = [];

      for (const product of products) {
        if (hasConditions && !isSmartSchedule && !isHolidaySchedule) {
          const liveStatus = await Fleet.getInstance(
            schedule.email,
          ).getLiveStatus(product);
          if (!liveStatus) {
            logger.warn(
              `Cannot evaluate conditions for schedule ${schedule.id} — live status unavailable for site "${product.site_name}"`,
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
              logger.info(
                `Condition cleared for schedule ${schedule.id} on site "${product.site_name}" — resetting trigger`,
              );
              triggeredPerProduct.set(product.id, false);
            }
            continue;
          }

          if (wasTriggered) {
            if (process.env.DRY_RUN === "true") {
              logger.info(
                `[DRY RUN] Condition still met for schedule ${schedule.id} on site "${product.site_name}" — skipping (already triggered)`,
              );
            }
            continue;
          }

          triggeredPerProduct.set(product.id, true);
          logger.info(
            `Condition met for schedule ${schedule.id} on site "${product.site_name}" — firing actions`,
          );
        }

        for (const config of schedule.actions || []) {
          if (!this.isValidConfigurationItem(config, schedule)) {
            continue;
          }
          /* eslint-disable no-unexpected-multiline */
          const result = await Fleet.getInstance(schedule.email)
            .getActionMap()
            [config.action](product, config.value, schedule.conditions ?? []);
          /* eslint-enable no-unexpected-multiline */
          if (config.action === "setSmartGridCharging" && result != null) {
            smartChargingResults.push(result as SmartChargingLogResult);
          }
          actionsExecuted++;
        }
      }

      const smartCharging =
        smartChargingResults.length === 1
          ? smartChargingResults[0]
          : smartChargingResults.length > 1
            ? smartChargingResults
            : undefined;

      if (process.env.DRY_RUN === "true") {
        logger.info(
          {
            scheduleId: schedule.id,
            dryRun: true,
            ...(smartCharging && { smartCharging }),
          },
          `[DRY RUN] Evaluation complete for schedule ${schedule.id}`,
        );
      } else if (actionsExecuted > 0) {
        logger.info(
          {
            scheduleId: schedule.id,
            email: maskEmail(schedule.email),
            actionsExecuted,
            ...(smartCharging && { smartCharging }),
          },
          `Executed scheduled task ${schedule.id} for ${maskEmail(schedule.email)} (${actionsExecuted} action(s) applied)`,
        );
      } else {
        logger.warn(
          `Scheduled task ${schedule.id} for ${maskEmail(schedule.email)} completed but no actions were executed — check action key names`,
        );
      }

      if (schedule.id) {
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
      logger.error(
        `Error executing scheduled task ${schedule.id} for ${maskEmail(schedule.email)}: ${lastError}`,
      );
      sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] ${lastError}`,
        schedule.email,
      );
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

    try {
      const interval = CronExpressionParser.parse(schedule.cron, {
        tz: schedule.timezone,
        currentDate: new Date(),
      });
      const lastExpectedFire = interval.prev().toDate();
      const lastRun = schedule.last_run_time;

      if (lastRun && new Date(lastRun) >= lastExpectedFire) {
        logger.info(
          `Schedule ${schedule.id} already ran after last expected fire — no recovery needed`,
        );
        return;
      }

      logger.info(
        `Recovering missed run for schedule ${schedule.id} — last expected: ${lastExpectedFire.toISOString()}, last run: ${lastRun ? new Date(lastRun).toISOString() : "never"}`,
      );
      await this.runEvaluation(schedule, new Map());
    } catch (err: any) {
      logger.error(err, `Recovery check failed for schedule ${schedule.id}`);
    }
  }

  async initializeOneSchedule(schedule: ISchedule) {
    if (!this.isValidSchedule(schedule)) {
      return;
    }
    const triggeredPerProduct = new Map<string, boolean>();
    const task = scheduleTask(
      schedule.cron,
      () => this.runEvaluation(schedule, triggeredPerProduct),
      { timezone: schedule.timezone },
    );
    logger.info(
      `Registered schedule ID ${schedule.id} | cron: "${schedule.cron}" | timezone: ${schedule.timezone} | next run: ${task.getNextRun()?.toISOString() ?? "unknown"}`,
    );
    this.enabledScheduledTasks.set(schedule.id || "", task);
    await this.maybeRecoverSchedule(schedule);
  }

  async initialize(schedulingEnabled = true) {
    this.schedulingEnabled = schedulingEnabled;
    this.validEmails = await getAllEmailsFromDb();
    logger.info(
      {
        event: "scheduler.emails.loaded",
        count: this.validEmails.length,
        users: this.validEmails.map(({ id, email }) => ({
          userId: id,
          email: maskEmail(email),
        })),
      },
      `Found ${this.validEmails.length} valid email(s) for scheduling`,
    );
    if (!this.schedulingEnabled) {
      logger.info("Scheduling is disabled. No tasks will be initialized.");
      return;
    }
    logger.info("Initializing scheduled tasks...");
    this.enabledScheduledTasks.clear();
    const schedules = await getAllSchedulesFromDb();
    logger.info(`Found ${schedules.length} schedule(s) in database.`);
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
          logger.error(err, `Calibration check failed for ${maskEmail(email)}`);
        }
      }
    });
    logger.info("Calibration detection task initialized.");

    // Internal task — not user-configurable, idempotent at 6-hour granularity, no recovery mechanism.
    this.curveCronTask?.stop();
    this.curveCronTask = scheduleTask("0 */6 * * *", async () => {
      logger.info("Running charge curve aggregation and sample purge job");
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
              logger.info(
                { site_id },
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
            logger.info(
              {
                site_id,
                bins: updated.bins.length,
                blended: existingData !== null,
              },
              "Curve aggregation: charge_curve updated",
            );
          } catch (err: any) {
            logger.error(err, `Curve aggregation failed for site ${site_id}`);
          }
        }

        const { affected } = await sampleRepo
          .createQueryBuilder()
          .delete()
          .where("creation_time < :cutoff", { cutoff })
          .execute();
        if (affected && affected > 0) {
          logger.info(
            { affected },
            "Curve aggregation: purged expired calibration samples",
          );
        }
      } catch (err: any) {
        logger.error(
          err,
          "Charge curve aggregation and sample purge job failed",
        );
      }
    });
    logger.info(
      "Charge curve aggregation and sample purge task initialized (every 6 hours).",
    );
  }

  async stopAll() {
    for (const [id, task] of this.enabledScheduledTasks.entries()) {
      logger.info(`Stopping scheduled task with ID ${id}`);
      task.stop();
      this.enabledScheduledTasks.delete(id);
    }
    this.calibrationTask?.stop();
    this.calibrationTask = null;
    this.curveCronTask?.stop();
    this.curveCronTask = null;
    logger.info("All scheduled tasks stopped.");
  }

  async startAll() {
    for (const [id, task] of this.enabledScheduledTasks.entries()) {
      logger.info(`Starting scheduled task with ID ${id}`);
      task.start();
    }
    logger.info("All scheduled tasks started.");
  }

  async upsert(schedule: ISchedule) {
    if (!this.validEmails.some(({ email }) => email === schedule.email)) {
      logger.warn(
        `Schedule for email ${maskEmail(schedule.email)} has no corresponding refresh token.`,
      );
      return;
    }
    const existingTask = this.enabledScheduledTasks.get(schedule.id || "");
    if (existingTask) {
      logger.info(`Updating existing scheduled task with ID ${schedule.id}`);
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
          logger.error(
            err,
            `Immediate holiday evaluation failed for schedule ${schedule.id}`,
          ),
        );
      }
    }
    return result;
  }

  async delete(scheduleId: string) {
    const task = this.enabledScheduledTasks.get(scheduleId);
    if (task) {
      logger.info(`Deleting scheduled task with ID ${scheduleId}`);
      task.stop();
      this.enabledScheduledTasks.delete(scheduleId);
    }
    return deleteScheduleFromDb(scheduleId);
  }
}
