import { z } from "zod";

const ScheduleActionSchema = z.object({
  action: z.string(),
  value: z.unknown(),
});

const ScheduleConditionSchema = z.object({
  condition: z.string(),
  value: z.unknown(),
});

export const ScheduleUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  site_ids: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  expires_at: z.string().optional(),
  actions: z.array(ScheduleActionSchema).optional(),
  conditions: z.array(ScheduleConditionSchema).optional(),
});

export const ScheduleDeleteSchema = z.object({
  id: z.string().uuid(),
});

export type ScheduleUpsertInput = z.infer<typeof ScheduleUpsertSchema>;
export type ScheduleDeleteInput = z.infer<typeof ScheduleDeleteSchema>;
