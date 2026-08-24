// Runs conjunction screening + risk scoring off the main thread, continuously,
// so SGP4 work across ~19k objects never drops render frames.
//
// CLASSIC worker (no `{type:"module"}`) for Firefox <114 compatibility, which
// means it can't `import` conjunctionMath.js — that math is duplicated below.
// Also loads satellite.js@4.1.3 (last UMD build) instead of the ESM version
// index.html uses, since importScripts() needs a non-module script.
importScripts("https://cdn.jsdelivr.net/npm/satellite.js@4.1.3/dist/satellite.min.js");

// --- Conjunction/risk math (duplicated from conjunctionMath.js) -----------

function createSatrec(line1, line2) {
  const satrec = satellite.twoline2satrec(line1, line2);
  return satrec.error ? null : satrec;
}

function propagateEci(satrec, date) {
  const { position } = satellite.propagate(satrec, date);
  return position || null; // decayed/invalid orbit
}

const EARTH_GM_KM3_S2 = 398600.4418; // standard gravitational parameter, km^3/s^2

// Perigee/apogee from TLE elements alone — cheap first-pass filter (same one
// CARA/Socrates use) that only ever rules pairs OUT, never wrongly excludes one.
function orbitalAltitudeBand(satrec) {
  const meanMotionRadPerSec = satrec.no / 60; // satellite.js stores `no` in rad/min
  const semiMajorAxisKm = Math.cbrt(EARTH_GM_KM3_S2 / (meanMotionRadPerSec * meanMotionRadPerSec));
  const eccentricity = satrec.ecco;
  return {
    perigeeKm: semiMajorAxisKm * (1 - eccentricity),
    apogeeKm: semiMajorAxisKm * (1 + eccentricity),
  };
}

function altitudeBandsCouldOverlap(bandA, bandB, marginKm) {
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

const MAX_REL_ACCEL_KM_S2 = 0.02; // bounds relative accel between two orbiting objects
const SCAN_RESOLUTION_KM = 10;
const MIN_SCAN_STEP_S = 0.25;
const MAX_SCAN_STEP_S = 600;

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

// Minimum 3D separation over the window. Adaptive step (see conjunctionMath.js
// for the full reasoning): step size is solved from d - (v*dt + 0.5*a*dt^2)
// >= screenKm so a close approach can never hide inside a step.
function findMinSeparation(satrecA, satrecB, fromDate, windowMinutes, screenKm = CONJUNCTION_SCREEN_KM) {
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

  if (bestS === null) return null;
  if (bestIsLatest) bracketHiS = totalS;

  if (bestDistanceKm < screenKm + SCAN_RESOLUTION_KM) {
    const refined = goldenSectionMin(distanceAtS, bracketLoS, bracketHiS);
    if (refined && refined.value < bestDistanceKm) {
      bestDistanceKm = refined.value;
      bestS = refined.atS;
    }
  }

  return { distanceKm: bestDistanceKm, atDate: new Date(baseMs + bestS * 1000) };
}

// Kept in sync by hand with conjunctionMath.js's copy — see that file for
// why miss distance (not probability) is the scoring basis.
const RISK_BANDS = [
  { level: "critical", label: "Critical", maxKm: 1 },
  { level: "high", label: "High", maxKm: 2 },
  { level: "moderate", label: "Moderate", maxKm: 5 },
  { level: "low", label: "Low", maxKm: 25 },
];

const CONJUNCTION_SCREEN_KM = RISK_BANDS[RISK_BANDS.length - 1].maxKm;

// Below this, treat as a same-object data artifact (e.g. a station's modules
// sharing near-identical TLEs under separate NORAD IDs), not a real conjunction.
const MIN_REPORTABLE_KM = 0.5;

function riskForDistanceKm(distanceKm) {
  if (distanceKm < MIN_REPORTABLE_KM) return null;
  return RISK_BANDS.find((band) => distanceKm <= band.maxKm) ?? null;
}

// --- Worker orchestration --------------------------------------------------
//
// main -> worker: { type: "setTracked", noradIds: number[] }
// worker -> main:
//   { type: "catalogReady", objectCount, screenableCount }
//   { type: "result", noradId, name, generation, closeApproaches: [...] }
//   { type: "passComplete", generation }
//   { type: "error", context, message }

const SCREEN_WINDOW_MINUTES = 5 * 60;
const REFRESH_INTERVAL_MS = 60_000; // re-screen cadence as the window slides forward
const PREFILTER_MARGIN_KM = CONJUNCTION_SCREEN_KM; // tightest margin still provably safe
const YIELD_EVERY = 200; // pairs screened before yielding to the event loop

let catalog = []; // [{ noradId, name, type, satrec, band }]
let catalogReady = null;
let trackedIds = [];
let generation = 0; // bumped on every setTracked — invalidates stale in-flight results
let refreshTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportError(context, error) {
  postMessage({ type: "error", context, message: String((error && error.stack) || error) });
}

async function loadCatalog() {
  const response = await fetch("../../data/raw/tle-latest.json");
  const data = await response.json();

  for (const object of data.objects) {
    const satrec = createSatrec(object.line1, object.line2);
    if (!satrec) continue;
    catalog.push({
      noradId: object.norad_id,
      name: object.name,
      type: object.type,
      satrec,
      band: orbitalAltitudeBand(satrec),
    });
  }

  postMessage({ type: "catalogReady", objectCount: data.objects.length, screenableCount: catalog.length });
}

async function screenOne(tracked, myGeneration) {
  const trackedEntry = catalog.find((entry) => entry.noradId === tracked);
  if (!trackedEntry) return;

  const fromDate = new Date();
  const closeApproaches = [];
  let sinceYield = 0;

  for (const other of catalog) {
    if (generation !== myGeneration) return; // superseded by a newer setTracked
    if (other.noradId === trackedEntry.noradId) continue;

    if (!altitudeBandsCouldOverlap(trackedEntry.band, other.band, PREFILTER_MARGIN_KM)) continue;

    const result = findMinSeparation(trackedEntry.satrec, other.satrec, fromDate, SCREEN_WINDOW_MINUTES);
    if (!result) continue;

    const risk = riskForDistanceKm(result.distanceKm);
    if (risk) {
      closeApproaches.push({
        noradId: other.noradId,
        name: other.name,
        type: other.type,
        distanceKm: result.distanceKm,
        atDate: result.atDate.toISOString(),
        risk,
      });
    }

    sinceYield++;
    if (sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      await sleep(0);
    }
  }

  if (generation !== myGeneration) return;

  closeApproaches.sort((a, b) => a.distanceKm - b.distanceKm);
  postMessage({
    type: "result",
    noradId: trackedEntry.noradId,
    name: trackedEntry.name,
    generation: myGeneration,
    closeApproaches,
  });
}

// myGeneration/idsThisPass are captured at call time, not re-read after
// awaiting catalogReady — two setTracked calls firing back-to-back before
// the catalog resolves would otherwise both wake up and re-read the same
// already-bumped state, making one of them redundant.
async function runPass(myGeneration, idsThisPass) {
  await catalogReady;

  for (const noradId of idsThisPass) {
    if (generation !== myGeneration) return;
    await screenOne(noradId, myGeneration);
  }

  if (generation === myGeneration) {
    postMessage({ type: "passComplete", generation: myGeneration });
  }
}

function runPassSafely(myGeneration, idsThisPass) {
  runPass(myGeneration, idsThisPass)
    .then(() => scheduleRefresh())
    .catch((error) => reportError("runPass", error));
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (trackedIds.length === 0) return; // nothing tracked — don't screen on a timer forever
  refreshTimer = setTimeout(() => {
    runPassSafely(generation, trackedIds);
  }, REFRESH_INTERVAL_MS);
}

onmessage = (event) => {
  const { type } = event.data;
  if (type !== "setTracked") return;

  generation++;
  trackedIds = event.data.noradIds;
  runPassSafely(generation, trackedIds);
};

catalogReady = loadCatalog().catch((error) => {
  reportError("loadCatalog", error);
  throw error; // keep catalogReady rejected so any pending runPass() short-circuits
});
