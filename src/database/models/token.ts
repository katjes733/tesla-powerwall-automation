import { EntitySchema } from "typeorm";

export const Token = new EntitySchema({
  name: "Token",
  tableName: "tokens",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, unique: true, nullable: false },
    token: { type: "varchar", unique: true, nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: false },
  },
  indices: [
    {
      name: "idx_token_email",
      columns: ["email"],
      unique: true,
    },
  ],
});
