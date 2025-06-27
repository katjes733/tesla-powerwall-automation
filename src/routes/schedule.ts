import { v4 } from "uuid";
import AppDataSource from "~/database/datasource";
import { Schedule, type ISchedule } from "~/database/models/schedule";

export async function upsert({
  id,
  email,
  device_id,
  cron,
  timezone,
  enabled = true,
  expires_at,
  configuration,
  last_run_time,
  next_run_time,
  last_error,
  last_error_time,
  last_success_time,
}: ISchedule) {
  const scheduleRepo = (await AppDataSource.getInstance()).getRepository(
    Schedule,
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
      device_id,
      cron,
      timezone,
      enabled,
      expires_at,
      configuration,
      last_run_time,
      next_run_time,
      last_error,
      last_error_time,
      last_success_time,
    });
    status = 200;
  } else {
    await scheduleRepo.update(recordId, {
      modified_time: newDate,
      device_id,
      cron,
      timezone,
      enabled,
      expires_at,
      configuration,
      last_run_time,
      next_run_time,
      last_error,
      last_error_time,
      last_success_time,
    });
    status = 201;
  }

  return {
    status,
    action: status === 200 ? "created" : "updated",
    data: {
      id: recordId,
      email,
      device_id,
      cron,
      timezone,
      enabled,
      expires_at,
      configuration,
      last_run_time,
      next_run_time,
      last_error,
      last_error_time,
      last_success_time,
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
