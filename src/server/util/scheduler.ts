import type { ScheduledTask } from "node-cron";
import { schedule as scheduleTask } from "node-cron";
import moment from "moment-timezone";
import type {
  ISchedule,
  IScheduleAction,
} from "~/server/database/models/schedule";
import { getAllEmails as getAllEmailsFromDb } from "~/server/util/routes/refreshToken";
import {
  getAll as getAllSchedulesFromDb,
  upsert as upsertScheduleInDb,
  deleteById as deleteScheduleFromDb,
} from "~/server/util/routes/schedule";
import { sendEmail } from "./mailing";
import { Fleet } from "~/server/util/fleet";

export class Scheduler {
  private static instance: Scheduler;

  private enabledScheduledTasks: Map<string, ScheduledTask> = new Map();
  private validEmails: string[] = [];
  private schedulingEnabled: boolean = true;

  private constructor() {}

  public static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  private isValidSchedule(schedule: ISchedule): boolean {
    if (!this.validEmails.includes(schedule.email)) {
      logger.warn(
        `Schedule for email ${schedule.email} has no corresponding refresh token.`,
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
    if (!config.action || !config.value) {
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

  async initializeOneSchedule(schedule: ISchedule) {
    if (!this.isValidSchedule(schedule)) {
      return;
    }
    const task = scheduleTask(
      schedule.cron,
      async () => {
        const now = moment().tz(schedule.timezone);
        if (now.isAfter(moment(schedule.expires_at))) {
          logger.warn(`Schedule with ID ${schedule.id} has expired.`);
          this.enabledScheduledTasks.delete(schedule.id || "");
          task.destroy();
          return;
        }
        if (process.env.DRY_RUN === "true") {
          logger.info(
            `[DRY RUN] Evaluating scheduled task for email ${schedule.email} with ID ${schedule.id} — no writes will be made`,
          );
        } else {
          logger.info(
            `Executing scheduled task for email ${schedule.email} with ID ${schedule.id}`,
          );
        }
        try {
          const products = await Fleet.getInstance(schedule.email)
            .getEnergyProducts()
            .then((allProducts) => {
              return schedule.device_id === "ALL"
                ? allProducts
                : allProducts.filter(
                    (product) => product.id === schedule.device_id,
                  );
            });

          let actionsExecuted = 0;
          for (const product of products) {
            for (const config of schedule.actions || []) {
              if (!this.isValidConfigurationItem(config, schedule)) {
                continue;
              }
              /* eslint-disable no-unexpected-multiline */
              await Fleet.getInstance(schedule.email)
                .getActionMap()
                [config.action](product, parseInt(config.value));
              /* eslint-enable no-unexpected-multiline */
              actionsExecuted++;
            }
          }
          if (process.env.DRY_RUN === "true") {
            logger.info(
              `[DRY RUN] Evaluation complete for schedule ID ${schedule.id} — no changes sent to Tesla API`,
            );
          } else if (actionsExecuted > 0) {
            logger.info(
              `Executed scheduled task for email ${schedule.email} with ID ${schedule.id} successfully (${actionsExecuted} action(s) applied)`,
            );
          } else {
            logger.warn(
              `Scheduled task for email ${schedule.email} with ID ${schedule.id} completed but no actions were executed — check action key names`,
            );
          }
          if (schedule.id) {
            upsertScheduleInDb({
              id: schedule.id,
              lastRunTime: now.toDate(),
              nextRunTime: task.getNextRun() || undefined,
              ...(process.env.DRY_RUN !== "true" && {
                lastSuccessTime: now.toDate(),
              }),
            });
          }
        } catch (error: any) {
          const lastError = error.message || "Unknown error";
          logger.error(
            `Error executing scheduled task for email ${schedule.email} with ID ${schedule.id}: ${lastError}`,
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
              nextRunTime: task.getNextRun() || undefined,
              lastError,
              lastErrorTime: now.toDate(),
            });
          }
        }
      },
      { timezone: schedule.timezone },
    );
    logger.info(
      `Registered schedule ID ${schedule.id} | cron: "${schedule.cron}" | timezone: ${schedule.timezone} | next run: ${task.getNextRun()?.toISOString() ?? "unknown"}`,
    );
    this.enabledScheduledTasks.set(schedule.id || "", task);
  }

  async initialize(schedulingEnabled = true) {
    this.schedulingEnabled = schedulingEnabled;
    this.validEmails = await getAllEmailsFromDb();
    logger.info(
      `Found ${this.validEmails.length} valid email(s) for scheduling${this.validEmails.length ? `: ${this.validEmails.join(", ")}` : ""}`,
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
  }

  async stopAll() {
    for (const [id, task] of this.enabledScheduledTasks.entries()) {
      logger.info(`Stopping scheduled task with ID ${id}`);
      task.stop();
      this.enabledScheduledTasks.delete(id);
    }
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
    if (!this.isValidSchedule(schedule)) {
      return;
    }
    const existingTask = this.enabledScheduledTasks.get(schedule.id || "");
    if (existingTask) {
      logger.info(`Updating existing scheduled task with ID ${schedule.id}`);
      existingTask.stop();
      this.enabledScheduledTasks.delete(schedule.id || "");
    }
    const result = await upsertScheduleInDb(schedule);
    schedule.id = result?.data?.id ?? schedule.id;
    if (this.schedulingEnabled) {
      await this.initializeOneSchedule(schedule);
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
