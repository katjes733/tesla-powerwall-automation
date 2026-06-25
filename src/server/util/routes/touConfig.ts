import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import type { ITouScheduleConfig } from "~/server/database/models/touScheduleConfig";

export async function listByEmailAndSite(
  email: string,
  siteId: string,
): Promise<ITouScheduleConfig[]> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "TouScheduleConfig",
  );
  return repo.find({
    where: { email, site_id: siteId },
    order: { creation_time: "DESC" },
  }) as Promise<ITouScheduleConfig[]>;
}

export async function save({
  id,
  email,
  schedule_name,
  site_id,
  schedule_config,
}: {
  id?: string;
  email: string;
  schedule_name: string;
  site_id: string;
  schedule_config: Record<string, unknown>;
}): Promise<{ id: string }> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "TouScheduleConfig",
  );
  const now = new Date();

  if (!id) {
    const newId = v4();
    await repo.insert({
      id: newId,
      creation_time: now,
      modified_time: now,
      email,
      schedule_name,
      site_id,
      schedule_config,
      is_active: false,
    });
    return { id: newId };
  }

  await repo.update(
    { id, email },
    { modified_time: now, schedule_name, schedule_config },
  );
  return { id };
}

export async function deleteById(
  id: string,
  email: string,
): Promise<{ status: number }> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "TouScheduleConfig",
  );
  const existing = await repo.findOne({ where: { id, email } });
  if (!existing) return { status: 404 };
  await repo.delete({ id });
  return { status: 204 };
}

export async function setActive(
  id: string,
  email: string,
  siteId: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "TouScheduleConfig",
  );
  const now = new Date();
  await repo.update(
    { email, site_id: siteId },
    { is_active: false, modified_time: now },
  );
  await repo.update({ id, email }, { is_active: true, modified_time: now });
}
