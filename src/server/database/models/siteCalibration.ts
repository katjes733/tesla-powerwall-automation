import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IGridChargeRateCalibrationData {
  kw: number;
  soc_percent: number;
  solar_kw: number;
  battery_kw: number;
  sample_count: number;
}

export interface ISiteCalibration {
  email: string;
  site_id: string;
  calibration_type: string;
  calibration_data: Record<string, unknown>;
}

export const SiteCalibration = new EntitySchema<
  IBasicEntity & ISiteCalibration
>({
  name: "SiteCalibration",
  tableName: "site_calibrations",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    calibration_type: { type: "varchar", length: 100, nullable: false },
    calibration_data: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_site_calibration_lookup",
      columns: ["email", "site_id", "calibration_type", "creation_time"],
      unique: false,
    },
    {
      name: "idx_site_calibration_site",
      columns: ["email", "site_id"],
      unique: false,
    },
  ],
});
