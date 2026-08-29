// Conjunction (close-approach) screening + risk scoring. Lives outside both
// frontend/ and backend/ because both sides use it: the frontend imports it
// directly (satellite.js resolved via the browser import map) for the
// single-satellite screen, and the backend imports it (satellite.js resolved
// via shared/node_modules) for the catalog-wide scan behind the API. It's
// also why this stays framework-free — no DOM, no three.js, pure math.
//
// conjunctionWorker.js can't import this (classic Worker, no ESM `import`)
// so it carries its own hand-synced copy — see the comment at its top.

import * as satellite from "satellite.js";

export function createSatrec(line1, line2) {
  const satrec = satellite.twoline2satrec(line1, line2);
  return satrec.error ? null : satrec;
}

export function propagateEci(satrec, date) {
  const { position } = satellite.propagate(satrec, date);
  return position || null; // null on propagation failure (decayed/invalid orbit)
}

const EARTH_GM_KM3_S2 = 398600.4418; // standard gravitational parameter, km^3/s^2

// Perigee/apogee from TLE elements alone, no propagation. Orbits whose bands
// don't overlap (within marginKm) can never come within marginKm anywhere —
// same first-pass filter CARA/Socrates use.
export function orbitalAltitudeBand(satrec) {
  const meanMotionRadPerSec = satrec.no / 60; // satellite.js stores `no` in rad/min
  const semiMajorAxisKm = Math.cbrt(EARTH_GM_KM3_S2 / (meanMotionRadPerSec * meanMotionRadPerSec));
  const eccentricity = satrec.ecco;
  return {
    perigeeKm: semiMajorAxisKm * (1 - eccentricity),
    apogeeKm: semiMajorAxisKm * (1 + eccentricity),
  };
}

export function altitudeBandsCouldOverlap(bandA, bandB, marginKm) {
  return bandA.apogeeKm + marginKm >= bandB.perigeeKm && bandB.apogeeKm + marginKm >= bandA.perigeeKm;
}

function separationKmAt(satrecA, satrecB, date) {
  const posA = propagateEci(satrecA, date);
  const posB = propagateEci(satrecB, date);
  if (!posA || !posB) return null;
  return Math.hypot(posA.x - posB.x, posA.y - posB.y, posA.z - posB.z);
}

function separationStateAt(satrecA, satrecB, date) {
  const a = satellite.propagate(satrecA, date);
  const b = satellite.propagate(satrecB, date);
  if (!a.position || !b.position || !a.velocity || !b.velocity) return null;
  return {
    distanceKm: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z),
    relSpeedKms: Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y, a.velocity.z - b.velocity.z),
  };
}

// Bounds relative acceleration between two Earth-orbiting objects (~2x max gravity).
const MAX_REL_ACCEL_KM_S2 = 0.02;
const SCAN_RESOLUTION_KM = 10;
const MIN_SCAN_STEP_S = 0.25;
const MAX_SCAN_STEP_S = 600;

// Golden-section minimization over a bracketed unimodal dip.
function goldenSectionMin(fn, loS, hiS, iterations = 30) {
  if (!(hiS > loS)) return null;
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let a = loS;
  let b = hiS;
  let c = b - (b - a) * invPhi;
  let d = a + (b - a) * invPhi;
  let fc = fn(c) ?? Infinity;
  let fd = fn(d) ?? Infinity;

  for (let i = 0; i < iterations; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - (b - a) * invPhi;
      fc = fn(c) ?? Infinity;
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + (b - a) * invPhi;
      fd = fn(d) ?? Infinity;
    }
  }

  const value = Math.min(fc, fd);
  return Number.isFinite(value) ? { atS: fc < fd ? c : d, value } : null;
}

// Minimum 3D separation over [fromDate, fromDate + windowMinutes]. Adaptive
// step, not a fixed grid: a fixed grid coarse enough to be affordable can
// step clean over a fast LEO close approach and miss it entirely. Step size
// is solved from d - (v*dt + 0.5*a*dt^2) >= screenKm, so it's the longest
// jump that provably can't hide a conjunction — big steps far away, tiny
// steps when closing fast or already close.
export function findMinSeparation(satrecA, satrecB, fromDate, windowMinutes, screenKm = CONJUNCTION_SCREEN_KM) {
  const baseMs = fromDate.getTime();
  const totalS = windowMinutes * 60;
  const distanceAtS = (s) => separationKmAt(satrecA, satrecB, new Date(baseMs + s * 1000));

  let bestS = null;
  let bestDistanceKm = Infinity;
  let bracketLoS = 0;
  let bracketHiS = 0;
  let bestIsLatest = false;
  let prevS = 0;

  for (let t = 0; t <= totalS; ) {
    const sample = separationStateAt(satrecA, satrecB, new Date(baseMs + t * 1000));

    if (sample === null) {
      // Propagation failed (decayed/unstable orbit) — fall back to a bounded step.
      if (bestIsLatest) {
        bracketHiS = t;
        bestIsLatest = false;
      }
      prevS = t;
      t += MAX_SCAN_STEP_S;
      continue;
    }

    if (sample.distanceKm < bestDistanceKm) {
      bestDistanceKm = sample.distanceKm;
      bestS = t;
      bracketLoS = prevS;
      bestIsLatest = true;
    } else if (bestIsLatest) {
      bracketHiS = t;
      bestIsLatest = false;
    }

    const slackKm = Math.max(SCAN_RESOLUTION_KM, sample.distanceKm - screenKm);
    const v = sample.relSpeedKms;
    const stepS = (-v + Math.sqrt(v * v + 2 * MAX_REL_ACCEL_KM_S2 * slackKm)) / MAX_REL_ACCEL_KM_S2;

    prevS = t;
    t += Math.min(MAX_SCAN_STEP_S, Math.max(MIN_SCAN_STEP_S, stepS));
  }

  if (bestS === null) return null; // propagation failed at every sample
  if (bestIsLatest) bracketHiS = totalS;

  // Only worth polishing pairs actually near the reporting threshold.
  if (bestDistanceKm < screenKm + SCAN_RESOLUTION_KM) {
    const refined = goldenSectionMin(distanceAtS, bracketLoS, bracketHiS);
    if (refined && refined.value < bestDistanceKm) {
      bestDistanceKm = refined.value;
      bestS = refined.atS;
    }
  }

  return { distanceKm: bestDistanceKm, atDate: new Date(baseMs + bestS * 1000) };
}

// Miss-distance risk bands (nearest first). Real conjunction assessment
// scores collision PROBABILITY (needs object size + covariance, not in a
// TLE) — miss distance is the practical TLE-only proxy, thresholds picked
// to be a legible signal rather than a probability claim.
export const RISK_BANDS = [
  { level: "critical", label: "Critical", maxKm: 1 },
  { level: "high", label: "High", maxKm: 2 },
  { level: "moderate", label: "Moderate", maxKm: 5 },
  { level: "low", label: "Low", maxKm: 25 },
];

// Anything farther than this is ignored entirely.
export const CONJUNCTION_SCREEN_KM = RISK_BANDS[RISK_BANDS.length - 1].maxKm;

// Anything closer than this is also ignored — catalogs track a station's
// individual modules as separate NORAD IDs sharing near-identical TLEs,
// which would otherwise report ~0km as a false "conjunction".
export const MIN_REPORTABLE_KM = 0.5;

export function riskForDistanceKm(distanceKm) {
  if (distanceKm < MIN_REPORTABLE_KM) return null;
  return RISK_BANDS.find((band) => distanceKm <= band.maxKm) ?? null;
}
