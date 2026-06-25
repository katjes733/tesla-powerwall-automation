import { z } from "zod";

export const TouConfigSaveSchema = z.object({
  id: z.string().uuid().optional(),
  schedule_name: z.string().min(1).max(255),
  site_id: z.string().min(1),
  schedule_config: z.record(z.string(), z.unknown()),
  mark_active: z.boolean().optional(),
});

export const TouConfigDeleteSchema = z.object({
  id: z.string().uuid(),
});

export const TouConfigApplySchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().min(1),
  backup: z.boolean().optional(),
});

export type TouConfigSaveInput = z.infer<typeof TouConfigSaveSchema>;
export type TouConfigDeleteInput = z.infer<typeof TouConfigDeleteSchema>;
export type TouConfigApplyInput = z.infer<typeof TouConfigApplySchema>;
