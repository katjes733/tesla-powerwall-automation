import { EntitySchema } from "typeorm";

export const RefreshToken = new EntitySchema({
  name: "RefreshToken",
  tableName: "refresh_tokens",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, unique: true, nullable: false },
    refresh_token: { type: "varchar", unique: true, nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: false },
    last_refresh_error: { type: "varchar", nullable: true },
    last_refresh_error_at: { type: "timestamp with time zone", nullable: true },
  },
  indices: [
    {
      name: "idx_refresh_token_email",
      columns: ["email"],
      unique: true,
    },
  ],
});
