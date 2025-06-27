import { v4 } from "uuid";
import AppDataSource from "~/database/datasource";
import { Schedule, type ISchedule } from "~/database/models/schedule";

export async function upsert({
  id,
  email,
  deviceId,
  cron,
  timezone,
  enabled = true,
  expiresAt,
  configuration,
  lastRunTime,
  nextRunTime,
  lastError,
  lastErrorTime,
  lastSuccessTime,
}: {
  id?: string;
  email?: string;
  deviceId?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  expiresAt?: Date;
  configuration?: Record<string, any>;
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
      device_id: deviceId,
      cron,
      timezone,
      enabled,
      expires_at: expiresAt,
      configuration,
      last_run_time: lastRunTime,
      next_run_time: nextRunTime,
      last_error: lastError,
      last_error_time: lastErrorTime,
      last_success_time: lastSuccessTime,
    });
    status = 200;
  } else {
    // Only include provided fields in the update
    const updateFields: Record<string, any> = { modified_time: newDate };
    if (cron !== undefined) updateFields.cron = cron;
    if (timezone !== undefined) updateFields.timezone = timezone;
    if (enabled !== undefined) updateFields.enabled = enabled;
    if (expiresAt !== undefined) updateFields.expires_at = expiresAt;
    if (configuration !== undefined) updateFields.configuration = configuration;
    if (lastRunTime !== undefined) updateFields.last_run_time = lastRunTime;
    if (nextRunTime !== undefined) updateFields.next_run_time = nextRunTime;
    if (lastError !== undefined) updateFields.last_error = lastError;
    if (lastErrorTime !== undefined)
      updateFields.last_error_time = lastErrorTime;
    if (lastSuccessTime !== undefined)
      updateFields.last_success_time = lastSuccessTime;
    if (email !== undefined) updateFields.email = email;
    if (deviceId !== undefined) updateFields.device_id = deviceId;
    await scheduleRepo.update(recordId, updateFields);
    status = 201;
  }

  return {
    status,
    action: status === 200 ? "created" : "updated",
    data: {
      id: recordId,
      email,
      deviceId,
      cron,
      timezone,
      enabled,
      expiresAt,
      configuration,
      lastRunTime,
      nextRunTime,
      lastError,
      lastErrorTime,
      lastSuccessTime,
    },
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
