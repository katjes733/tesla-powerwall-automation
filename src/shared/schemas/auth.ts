import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const SendCodeSchema = z.object({
  email: z.string().email(),
});

export const VerifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type SendCodeInput = z.infer<typeof SendCodeSchema>;
export type VerifyCodeInput = z.infer<typeof VerifyCodeSchema>;
