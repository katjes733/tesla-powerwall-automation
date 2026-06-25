import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface ITouScheduleConfig extends IBasicEntity {
  email: string;
  schedule_name: string;
  site_id: string;
  schedule_config: Record<string, unknown>;
  is_active: boolean;
}

export const TouScheduleConfig = new EntitySchema<ITouScheduleConfig>({
  name: "TouScheduleConfig",
  tableName: "tou_schedule_configs",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    schedule_name: { type: "varchar", length: 255, nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    schedule_config: { type: "jsonb", nullable: false },
    is_active: { type: "boolean", default: false, nullable: false },
  },
  indices: [
    {
      name: "idx_tou_schedule_config_email_site",
      columns: ["email", "site_id"],
      unique: false,
    },
  ],
});
