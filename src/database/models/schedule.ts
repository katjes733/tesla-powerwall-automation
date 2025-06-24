import { EntitySchema } from "typeorm";

export const Schedule = new EntitySchema({
  name: "Schedule",
  tableName: "schedules",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, unique: true, nullable: false },
    device_id: { type: "varchar", length: 255, nullable: false },
    cron: { type: "varchar", length: 255, unique: true, nullable: false },
    timezone: { type: "varchar", length: 255, nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: true },
    enabled: { type: "boolean", default: true, nullable: false },
    configuration: { type: "jsonb", nullable: true },
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
      name: "idx_schedule_device_id",
      columns: ["device_id"],
      unique: false,
    },
    {
      name: "idx_schedule_cron_timezone",
      columns: ["cron", "timezone"],
      unique: false,
    },
  ],
});
