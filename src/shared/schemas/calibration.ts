import { z } from "zod";

export const CalibrationStartSchema = z.object({
  siteId: z.string().min(1),
});

export const CalibrationClearSchema = z.object({
  siteId: z.string().min(1),
});

export type CalibrationStartInput = z.infer<typeof CalibrationStartSchema>;
export type CalibrationClearInput = z.infer<typeof CalibrationClearSchema>;

export const CurveStartSchema = z.object({
  siteId: z.string().min(1),
});

export type CurveStartInput = z.infer<typeof CurveStartSchema>;
