import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import {
  Schedule,
  type ISchedule,
  type IScheduleAction,
  type IScheduleCondition,
} from "~/server/database/models/schedule";

export async function upsert({
  id,
  email,
  siteIds,
  cron,
  timezone,
  enabled = true,
  expiresAt,
  conditions,
  actions,
  lastRunTime,
  nextRunTime,
  lastError,
  lastErrorTime,
  lastSuccessTime,
}: {
  id?: string;
  email?: string;
  siteIds?: string[];
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  expiresAt?: Date;
  conditions?: IScheduleCondition[];
  actions?: IScheduleAction[];
  lastRunTime?: Date;
  nextRunTime?: Date;
  lastError?: string;
  lastErrorTime?: Date;
  lastSuccessTime?: Date;
}) {
  const scheduleRepo = (await AppDataSource.getInstance()).getRepository(
    "Schedule",
  );
  let recordId = id;

  const newDate = new Date();

  let status;

  if (!recordId) {
    recordId = v4();
    await scheduleRepo.insert({
      id: recordId,
      creation_time: newDate,
      modified_time: newDate,
      email,
      site_ids: siteIds,
      cron,
      timezone,
      enabled,
      expires_at: expiresAt,
      conditions,
      actions,
      last_run_time: lastRunTime,
      next_run_time: nextRunTime,
      last_error: lastError,
      last_error_time: lastErrorTime,
      last_success_time: lastSuccessTime,
    });
    status = 200;
  } else {
    const updateFields: Record<string, any> = { modified_time: newDate };
    if (cron !== undefined) updateFields.cron = cron;
    if (timezone !== undefined) updateFields.timezone = timezone;
    if (enabled !== undefined) updateFields.enabled = enabled;
    if (expiresAt !== undefined) updateFields.expires_at = expiresAt;
    if (siteIds !== undefined) updateFields.site_ids = siteIds;
    if (conditions !== undefined) updateFields.conditions = conditions;
    if (actions !== undefined) updateFields.actions = actions;
    if (lastRunTime !== undefined) updateFields.last_run_time = lastRunTime;
    if (nextRunTime !== undefined) updateFields.next_run_time = nextRunTime;
    if (lastError !== undefined) updateFields.last_error = lastError;
    if (lastErrorTime !== undefined)
      updateFields.last_error_time = lastErrorTime;
    if (lastSuccessTime !== undefined)
      updateFields.last_success_time = lastSuccessTime;
    if (email !== undefined) updateFields.email = email;
    await scheduleRepo.update(recordId, updateFields);
    status = 201;
  }

  return {
    status,
    action: status === 200 ? "create" : "update",
    data: {
      id: recordId,
      email,
      siteIds,
      cron,
      timezone,
      enabled,
      expiresAt,
      conditions,
      actions,
      lastRunTime,
      nextRunTime,
      lastError,
      lastErrorTime,
      lastSuccessTime,
    },
  };
}

export async function deleteById(id: string) {
  const scheduleRepo = (await AppDataSource.getInstance()).getRepository(
    Schedule,
  );
  const result = await scheduleRepo.delete(id);
  if (result.affected === 0) {
    return { status: 404, action: "delete" };
  }
  return {
    status: 204,
    action: "delete",
  };
}

export async function getAll() {
  const scheduleRepo = (await AppDataSource.getInstance()).getRepository(
    Schedule,
  );
  return scheduleRepo.find() as Promise<ISchedule[]>;
}

export async function getByEmail(email: string) {
  const scheduleRepo = (await AppDataSource.getInstance()).getRepository(
    Schedule,
  );
  return scheduleRepo.find({
    where: { email },
  }) as Promise<ISchedule[]>;
}
