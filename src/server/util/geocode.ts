import { findCoordinates } from "zipcodes-us";

// ZIP-to-coordinate mapping is static reference data (ZIP centroids
// essentially never change), so this is a fully offline, in-process lookup —
// no network call, no external service dependency, no retry needed.
export function geocodeUsZip(zip: string): { lat: number; lon: number } | null {
  const result = findCoordinates(zip);
  if (!result.isValid) return null;
  return { lat: result.latitude, lon: result.longitude };
}
