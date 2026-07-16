import { describe, it, expect } from "vitest";
import { geocodeUsZip } from "~/server/util/geocode";

describe("geocodeUsZip", () => {
  it("resolves lat/lon for a valid ZIP code", () => {
    expect(geocodeUsZip("85001")).toEqual({ lat: 33.4484, lon: -112.074 });
  });

  it("returns null for an unrecognized ZIP code", () => {
    expect(geocodeUsZip("00000")).toBeNull();
  });
});
