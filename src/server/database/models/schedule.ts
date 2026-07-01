import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export type SeasonalWindow = { seasonName: string; from: string; to: string };

export type HolidayEntry = {
  name: string;
  /** "MM-DD" for fixed holidays, or an ordinal descriptor for floating ones:
   *  "lastMon05" = last Mon in May, "1stMon09" = 1st Mon in Sep,
   *  "4thThu11" = 4th Thu in Nov, "3rdMon01" = 3rd Mon in Jan, etc.
   *  Format: "<ordinal><dow><MM>" where ordinal ∈ {1st,2nd,3rd,4th,last},
   *  dow ∈ {Mon,Tue,Wed,Thu,Fri}, MM = zero-padded month.
   */
  date: string;
  /** "auto": Sat→Fri, Sun→Mon. Only meaningful for fixed dates. */
  observance: "auto" | "none";
  source: string;
  enabled: boolean;
};

export interface IScheduleCondition {
  condition: string;
  value:
    | number
    | { from: string; to: string }
    | SeasonalWindow[]
    | HolidayEntry[]
    | null;
}
export interface IScheduleAction {
  action: string;
  value: string;
}

export interface IScheduleOptions {
  recovery?: "none" | "on_restart";
}

export function resolveScheduleOptions(
  raw: unknown,
): Required<IScheduleOptions> {
  const opts = (raw ?? {}) as Partial<IScheduleOptions>;
  return {
    recovery: opts.recovery ?? "none",
  };
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
  options?: IScheduleOptions | null;
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
    options: { type: "jsonb", nullable: true },
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
