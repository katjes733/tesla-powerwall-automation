import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export type HolidayOverrideAction = "override" | "restore" | "none" | "failed";

export interface ISiteHolidayStatus {
  site_id: string;
  /** YYYY-MM-DD, the site-local date this check was evaluated for. */
  date: string;
  action: HolidayOverrideAction;
  holiday_name: string | null;
  error: string | null;
  checked_at: Date;
}

export const SiteHolidayStatus = new EntitySchema<
  IBasicEntity & ISiteHolidayStatus
>({
  name: "SiteHolidayStatus",
  tableName: "site_holiday_status",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    date: { type: "varchar", length: 10, nullable: false },
    action: { type: "varchar", length: 20, nullable: false },
    holiday_name: { type: "varchar", length: 255, nullable: true },
    error: { type: "text", nullable: true },
    checked_at: { type: "timestamp with time zone", nullable: false },
  },
  indices: [
    {
      name: "idx_site_holiday_status_site_id",
      columns: ["site_id"],
      unique: true,
    },
  ],
});
