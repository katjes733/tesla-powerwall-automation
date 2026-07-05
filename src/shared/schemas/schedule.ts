import { z } from "zod";

const ScheduleActionSchema = z.object({
  action: z.string(),
  value: z.unknown(),
});

const ScheduleConditionSchema = z.object({
  condition: z.string(),
  value: z.unknown(),
});

const ScheduleOptionsSchema = z.object({
  recovery: z.enum(["none", "on_restart"]).optional(),
  runOnce: z.boolean().optional(),
});

export const ScheduleUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  site_ids: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
  actions: z.array(ScheduleActionSchema).nullable().optional(),
  conditions: z.array(ScheduleConditionSchema).nullable().optional(),
  options: ScheduleOptionsSchema.nullable().optional(),
});

export const ScheduleDeleteSchema = z.object({
  id: z.string().uuid(),
});

export type ScheduleUpsertInput = z.infer<typeof ScheduleUpsertSchema>;
export type ScheduleDeleteInput = z.infer<typeof ScheduleDeleteSchema>;
