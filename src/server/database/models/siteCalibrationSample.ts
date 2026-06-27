import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface ISiteCalibrationSampleData {
  soc_percent: number;
  battery_kw: number;
  solar_kw: number;
  grid_kw: number;
}

export interface ISiteCalibrationSample {
  email: string;
  site_id: string;
  calibration_type: string; // "passive" | "manual"
  sample_data: ISiteCalibrationSampleData;
}

export const SiteCalibrationSample = new EntitySchema<
  IBasicEntity & ISiteCalibrationSample
>({
  name: "SiteCalibrationSample",
  tableName: "site_calibration_samples",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    calibration_type: { type: "varchar", length: 100, nullable: false },
    sample_data: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_calsample_lookup",
      columns: ["email", "site_id", "calibration_type", "creation_time"],
      unique: false,
    },
  ],
});
