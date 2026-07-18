import { findByRadius, findCoordinates } from "zipcodes-us";

// ZIP-to-coordinate mapping is static reference data (ZIP centroids
// essentially never change), so this is a fully offline, in-process lookup —
// no network call, no external service dependency, no retry needed.
export function geocodeUsZip(zip: string): { lat: number; lon: number } | null {
  const result = findCoordinates(zip);
  if (!result.isValid) return null;
  return { lat: result.latitude, lon: result.longitude };
}

// Widening search radius so sparsely-populated areas (fewer ZIPs per square
// mile) still resolve — findByRadius returns matches sorted nearest-first, so
// the first result at whichever radius first turns up a match is the
// closest ZIP overall, not just the closest within an arbitrary fixed radius.
const REVERSE_GEOCODE_RADII_MILES = [10, 25, 50];

// Approximates a ZIP for a raw lat/lon (e.g. from the browser's Geolocation
// API) purely so the UI has something friendlier than a blank field to show
// and edit — this app already treats ZIP-centroid precision as sufficient
// for regional weather, so the approximation from nearest-ZIP-lookup is fine
// for that purpose. Returns null only for coordinates with no ZIP within 50
// miles (open ocean, remote wilderness).
export function reverseGeocodeToZip(lat: number, lon: number): string | null {
  for (const radiusMiles of REVERSE_GEOCODE_RADII_MILES) {
    const matches = findByRadius(lat, lon, radiusMiles);
    if (matches.length > 0) return matches[0].zipCode;
  }
  return null;
}
