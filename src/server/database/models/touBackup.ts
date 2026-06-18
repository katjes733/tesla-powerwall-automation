import { EntitySchema } from "typeorm";

export interface ITouBackup {
  id?: string;
  creation_time: Date;
  modified_time: Date;
  email: string;
  site_id: string;
  tariff_content_v2: Record<string, unknown>;
}

export const TouBackup = new EntitySchema<ITouBackup>({
  name: "TouBackup",
  tableName: "tou_backups",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    tariff_content_v2: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_tou_backup_email_site",
      columns: ["email", "site_id"],
      unique: false,
    },
    {
      name: "idx_tou_backup_creation_time",
      columns: ["creation_time"],
      unique: false,
    },
  ],
});
