// Worker thread for runConjunctionScanParallel() (see conjunctions.js).
// Given a slice of target NORAD ids + the full catalog, builds its own
// screenable catalog and screens just its slice against all of it — the
// SGP4 propagation work is what's expensive, and it's embarrassingly
// parallel per target, so this is the whole point of splitting it up.
import { parentPort, workerData } from "node:worker_threads";
import { buildScreenableCatalog, findCloseApproaches } from "./conjunctions.js";

const { objects, targetIds } = workerData;

const screenable = buildScreenableCatalog(objects);
const byNoradId = new Map(screenable.map((entry) => [entry.noradId, entry]));

const results = [];
for (const noradId of targetIds) {
  const target = byNoradId.get(noradId);
  if (!target) continue; // not in the current catalog (decayed, or a bad watch request slipped through)

  // Dates don't survive structured clone as usefully as ISO strings do
  // across the postMessage boundary in every Node version this might run
  // on — serialize here, the main thread reconstructs Date objects only
  // where it actually needs one (alertWatchers).
  const closeApproaches = findCloseApproaches(target, screenable).map((approach) => ({
    ...approach,
    closestApproachAt: approach.closestApproachAt.toISOString(),
  }));

  results.push({ noradId: target.noradId, name: target.name, closeApproaches });
}

parentPort.postMessage(results);
