import type { ScheduledTask } from "node-cron";
import { schedule as scheduleTask } from "node-cron";
import parser from "cron-parser";
import moment from "moment-timezone";
import type { ISchedule } from "~/database/models/schedule";
import { getAllEmails } from "~/routes/refreshToken";
import { getAll as getAllSchedules } from "~/routes/schedule";

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

  async initialize() {
    this.validEmails = await getAllEmails();
    for (const schedule of await getAllSchedules()) {
      if (!this.isValidSchedule(schedule)) {
        continue; // Skip invalid schedules
      }
      const task = scheduleTask(schedule.cron, async () => {
        const now = moment().tz(schedule.timezone);
        // TODO: re-think this logic if this is needed, as we may want to check expiration manually
        // However, this is actually quite elegant, as it allows us to check expiration at the time of execution
        if (now.isAfter(moment(schedule.expires_at))) {
          logger.warn(`Schedule with ID ${schedule.id} has expired.`);
          this.enabledScheduledTasks.delete(schedule.id || "");
          task.destroy();
          return;
        }
        logger.info(
          `Executing scheduled task for email ${schedule.email} with ID ${schedule.id}`,
        );
        // TODO: Implement the actual task logic based on the schedule configuration
        let lastError: string | null = null;
        try {
        } catch (error: any) {
          lastError = error.message || "Unknown error";
          logger.error(
            `Error executing scheduled task for email ${schedule.email} with ID ${schedule.id}: ${lastError}`,
          );
          // TODO: send email notification
          // Need to modify email handling in Fleet to be optional there or if the exception should just passed through for consistency
        }

        now.toDate();
      });
    }
  }

  // Additional methods for scheduling can be added here
}
