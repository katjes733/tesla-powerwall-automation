import { EntitySchema } from "typeorm";

export interface ICalibrationEvent {
  id?: string;
  creation_time: Date;
  modified_time: Date;
  email: string;
  site_id: string;
  site_name: string;
  ended_at: Date | null;
}

export const CalibrationEvent = new EntitySchema<ICalibrationEvent>({
  name: "CalibrationEvent",
  tableName: "calibration_events",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    site_name: { type: "varchar", length: 255, nullable: false },
    ended_at: { type: "timestamp with time zone", nullable: true },
  },
  indices: [
    {
      name: "idx_calibration_event_email_site",
      columns: ["email", "site_id"],
      unique: false,
    },
    {
      name: "idx_calibration_event_ended_at",
      columns: ["ended_at"],
      unique: false,
    },
  ],
});
