import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface ISiteSettingsData {
  auto_curve_calibration_enabled?: boolean;
}

export interface ISiteSettings {
  site_id: string;
  settings: ISiteSettingsData;
}

export const DEFAULT_SITE_SETTINGS: Required<ISiteSettingsData> = {
  auto_curve_calibration_enabled: true,
};

export function resolveSiteSettings(
  stored: ISiteSettingsData | null,
): Required<ISiteSettingsData> {
  return { ...DEFAULT_SITE_SETTINGS, ...stored };
}

export const SiteSettings = new EntitySchema<IBasicEntity & ISiteSettings>({
  name: "SiteSettings",
  tableName: "site_settings",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    settings: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_site_settings_site_id",
      columns: ["site_id"],
      unique: true,
    },
  ],
});
