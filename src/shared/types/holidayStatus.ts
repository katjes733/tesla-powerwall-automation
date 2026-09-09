export type HolidayPillState = "applied" | "pending" | "failed";

export interface HolidayPillStatus {
  name: string;
  state: HolidayPillState;
  detail: string;
}

export const HOLIDAY_PILL_COLORS: Record<
  HolidayPillState,
  "success" | "warning" | "error"
> = {
  applied: "success",
  pending: "warning",
  failed: "error",
};
