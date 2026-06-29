import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export type LiveDataSampleType = "soc";

export interface ILiveDataSample {
  site_id: string;
  type: LiveDataSampleType;
  data: Record<string, unknown>;
}

export const LiveDataSample = new EntitySchema<IBasicEntity & ILiveDataSample>({
  name: "LiveDataSample",
  tableName: "live_data_samples",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    site_id: { type: "varchar", length: 255, nullable: false },
    type: { type: "varchar", length: 100, nullable: false },
    data: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_livedatasample_lookup",
      columns: ["site_id", "type", "creation_time"],
      unique: false,
    },
    {
      name: "idx_livedatasample_creation",
      columns: ["creation_time"],
      unique: false,
    },
  ],
});
