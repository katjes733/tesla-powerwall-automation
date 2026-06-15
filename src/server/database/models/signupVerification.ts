import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface ISignupVerification {
  id?: string;
  email: string;
  code: string;
  expires_at: Date;
}

export const SignupVerification = new EntitySchema<
  IBasicEntity & ISignupVerification
>({
  name: "SignupVerification",
  tableName: "signup_verification",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    code: { type: "varchar", nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: false },
  },
  indices: [
    { name: "idx_signup_verification_email", columns: ["email"], unique: true },
  ],
});
