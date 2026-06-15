import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IUser {
  id?: string;
  email: string;
  password_hash: string;
  user_details?: Record<string, any>;
  user_permissions?: Record<string, any>;
  refresh_token?: string;
  expires_at?: Date;
}

export const User = new EntitySchema<IBasicEntity & IUser>({
  name: "User",
  tableName: "users",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    password_hash: { type: "text", nullable: false },
    user_details: { type: "jsonb", nullable: true },
    user_permissions: { type: "jsonb", nullable: true },
    refresh_token: { type: "varchar", unique: true, nullable: true },
    expires_at: { type: "timestamp with time zone", nullable: true },
  },
  indices: [
    {
      name: "idx_user_email",
      columns: ["email"],
      unique: true,
    },
  ],
});
