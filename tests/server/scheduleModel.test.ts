import { describe, it, expect } from "vitest";
import { resolveScheduleOptions } from "~/server/database/models/schedule";

describe("resolveScheduleOptions", () => {
  it("returns defaults when called with null", () => {
    expect(resolveScheduleOptions(null)).toEqual({
      recovery: "none",
      runOnce: false,
    });
  });

  it("returns defaults when called with undefined", () => {
    expect(resolveScheduleOptions(undefined)).toEqual({
      recovery: "none",
      runOnce: false,
    });
  });

  it("returns defaults when called with an empty object", () => {
    expect(resolveScheduleOptions({})).toEqual({
      recovery: "none",
      runOnce: false,
    });
  });

  it("preserves an explicit recovery value", () => {
    expect(resolveScheduleOptions({ recovery: "on_restart" })).toEqual({
      recovery: "on_restart",
      runOnce: false,
    });
  });

  it("preserves runOnce: true", () => {
    expect(resolveScheduleOptions({ runOnce: true })).toEqual({
      recovery: "none",
      runOnce: true,
    });
  });

  it("preserves runOnce: false explicitly", () => {
    expect(resolveScheduleOptions({ runOnce: false })).toEqual({
      recovery: "none",
      runOnce: false,
    });
  });

  it("preserves both fields together", () => {
    expect(
      resolveScheduleOptions({ recovery: "on_restart", runOnce: true }),
    ).toEqual({ recovery: "on_restart", runOnce: true });
  });
});
