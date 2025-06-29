import type { ScheduledTask } from "node-cron";
import { schedule as scheduleTask } from "node-cron";
import moment from "moment-timezone";
import type {
  ISchedule,
  IScheduleConfiguration,
} from "~/database/models/schedule";
import { getAllEmails } from "~/routes/refreshToken";
import {
  getAll as getAllSchedules,
  upsert as upsertSchedule,
} from "~/routes/schedule";
import { sendEmail } from "./mailing";
import { Fleet } from "~/util/fleet";

export class Scheduler {
  private static instance: Scheduler;

  private enabledScheduledTasks: Map<string, ScheduledTask> = new Map();
  private validEmails: string[] = [];

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
    if (!schedule.configuration || schedule.configuration.length === 0) {
      logger.warn(
        `Schedule with ID ${schedule.id} has no configuration defined.`,
      );
      return false; // For now, just skip this schedule. Will re-think later if we should allow empty configs at all.
    }
    return true;
  }

  private isValidConfigurationItem(
    config: IScheduleConfiguration,
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

  async initialize() {
    this.validEmails = await getAllEmails();
    for (const schedule of await getAllSchedules()) {
      if (!this.isValidSchedule(schedule)) {
        continue;
      }
      const task = scheduleTask(schedule.cron, async () => {
        const now = moment().tz(schedule.timezone);
        if (now.isAfter(moment(schedule.expires_at))) {
          logger.warn(`Schedule with ID ${schedule.id} has expired.`);
          this.enabledScheduledTasks.delete(schedule.id || "");
          task.destroy();
          return;
        }
        logger.info(
          `Executing scheduled task for email ${schedule.email} with ID ${schedule.id}`,
        );
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

          for (const product of products) {
            for (const config of schedule.configuration || []) {
              if (!this.isValidConfigurationItem(config, schedule)) {
                continue;
              }
              /* eslint-disable no-unexpected-multiline */
              await Fleet.getInstance(schedule.email)
                .getActionMap()
                [config.action](product, parseInt(config.value));
              /* eslint-enable no-unexpected-multiline */
            }
          }
          logger.info(
            `Executed scheduled task for email ${schedule.email} with ID ${schedule.id} successfully`,
          );
          upsertSchedule({
            id: schedule.id,
            lastRunTime: now.toDate(),
            nextRunTime: task.getNextRun() || undefined,
            lastSuccessTime: now.toDate(),
          });
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
          upsertSchedule({
            id: schedule.id,
            lastRunTime: now.toDate(),
            nextRunTime: task.getNextRun() || undefined,
            lastError,
            lastErrorTime: now.toDate(),
          });
        }
      });
    }
  }
}
