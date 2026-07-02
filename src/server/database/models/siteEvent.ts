import { EntitySchema } from "typeorm";

export type SiteEventType = "calibration_bms_lock" | "calibration_discharge";

export interface ISiteEvent {
  id?: string;
  creation_time: Date;
  modified_time: Date;
  site_id: string;
  site_name: string;
  event_type: SiteEventType;
  event_payload: Record<string, unknown> | null;
}

export const SiteEvent = new EntitySchema<ISiteEvent>({
  name: "SiteEvent",
  tableName: "site_events",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    site_name: { type: "varchar", length: 255, nullable: false },
    event_type: { type: "varchar", length: 50, nullable: false },
    event_payload: { type: "jsonb", nullable: true },
  },
  indices: [
    {
      name: "idx_site_event_site",
      columns: ["site_id"],
      unique: false,
    },
    {
      name: "idx_site_event_type",
      columns: ["event_type"],
      unique: false,
    },
  ],
});
