import { z } from "zod";

export const UserUpsertSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  user_details: z.record(z.string(), z.unknown()).optional(),
  user_permissions: z.record(z.string(), z.unknown()).optional(),
  refresh_token: z.string().optional(),
  expires_at: z.string().optional(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type UserUpsertInput = z.infer<typeof UserUpsertSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
