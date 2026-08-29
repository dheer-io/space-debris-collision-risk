// TLE -> position / orbit path calculations. No Three.js scene objects, no DOM.

import * as satellite from "satellite.js";
import { coordinateToSphereVector } from "./threeGeoJSON.js";

export const EARTH_RADIUS_KM = 6371;
export const DEFAULT_ORBIT_SEGMENTS = 128;

export function createSatrec(line1, line2) {
  const satrec = satellite.twoline2satrec(line1, line2);
  return satrec.error ? null : satrec;
}

// gmstOverride freezes Earth's rotation for this calc (see computeOrbitPath) —
// draws a stable ring instead of a smear.
export function propagateToGeodetic(satrec, date, globeRadius, gmstOverride) {
  const { position } = satellite.propagate(satrec, date);
  if (!position) return null; // decayed/invalid orbit

  const gmst = gmstOverride ?? satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(position, gmst);
  const lonDeg = satellite.degreesLong(geodetic.longitude);
  const latDeg = satellite.degreesLat(geodetic.latitude);
  const sphereRadius = globeRadius + (geodetic.height / EARTH_RADIUS_KM) * globeRadius;

  return {
    spherePosition: coordinateToSphereVector([lonDeg, latDeg], sphereRadius),
    lat: latDeg,
    lon: lonDeg,
    altitudeKm: geodetic.height,
  };
}

// Samples a satellite's full orbit as globe-relative points, one fixed gmst
// for every sample. Caller MUST reuse gmstSnapshot for that satellite's live
// position too, or the marker slowly drifts off its own ring.
export function computeOrbitPath(satrec, atDate, globeRadius, segments = DEFAULT_ORBIT_SEGMENTS) {
  const periodMinutes = (2 * Math.PI) / satrec.no;
  const gmstSnapshot = satellite.gstime(atDate);
  const points = [];

  for (let i = 0; i <= segments; i++) {
    const sampleDate = new Date(atDate.getTime() + ((periodMinutes * i) / segments) * 60_000);
    const result = propagateToGeodetic(satrec, sampleDate, globeRadius, gmstSnapshot);
    if (result) points.push(result.spherePosition);
  }

  return { points, gmstSnapshot };
}

// Conjunction/risk math lives in shared/conjunctionMath.js instead, so the
// backend can reuse it too — neither side should have to pull in three.js.
