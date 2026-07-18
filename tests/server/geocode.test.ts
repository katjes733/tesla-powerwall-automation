import { describe, it, expect } from "vitest";
import { geocodeUsZip, reverseGeocodeToZip } from "~/server/util/geocode";

describe("geocodeUsZip", () => {
  it("resolves lat/lon for a valid ZIP code", () => {
    expect(geocodeUsZip("85001")).toEqual({ lat: 33.4484, lon: -112.074 });
  });

  it("returns null for an unrecognized ZIP code", () => {
    expect(geocodeUsZip("00000")).toBeNull();
  });
});

describe("reverseGeocodeToZip", () => {
  it("resolves the nearest ZIP for a real US coordinate", () => {
    // Niwot, CO (Boulder area) — within the initial 10-mile search radius.
    expect(reverseGeocodeToZip(40.1, -105.2)).toBe("80544");
  });

  it("returns null for coordinates with no nearby ZIP (open ocean)", () => {
    expect(reverseGeocodeToZip(0, 0)).toBeNull();
  });
});
