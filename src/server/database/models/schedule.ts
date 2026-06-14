import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IScheduleCondition {
  condition: string;
  value: string;
}
export interface IScheduleAction {
  action: string;
  value: string;
}

export interface ISchedule {
  id?: string;
  email: string;
  site_ids: string[];
  cron: string;
  timezone: string;
  enabled?: boolean;
  expires_at?: Date;
  conditions?: IScheduleCondition[];
  actions?: IScheduleAction[];
  last_run_time?: Date;
  next_run_time?: Date;
  last_error?: string;
  last_error_time?: Date;
  last_success_time?: Date;
}

export const Schedule = new EntitySchema<IBasicEntity & ISchedule>({
  name: "Schedule",
  tableName: "schedules",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    site_ids: { type: "jsonb", nullable: false },
    cron: { type: "varchar", length: 255, nullable: false },
    timezone: { type: "varchar", length: 255, nullable: false },
    enabled: { type: "boolean", default: true, nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: true },
    conditions: { type: "jsonb", nullable: true },
    actions: { type: "jsonb", nullable: true },
    last_run_time: { type: "timestamp with time zone", nullable: true },
    next_run_time: { type: "timestamp with time zone", nullable: true },
    last_error: { type: "text", nullable: true },
    last_error_time: { type: "timestamp with time zone", nullable: true },
    last_success_time: { type: "timestamp with time zone", nullable: true },
  },
  indices: [
    {
      name: "idx_schedule_email",
      columns: ["email"],
      unique: false,
    },
    {
      name: "idx_schedule_site_ids",
      columns: ["site_ids"],
      unique: false,
    },
    {
      name: "idx_schedule_cron_timezone",
      columns: ["cron", "timezone"],
      unique: false,
    },
  ],
});
