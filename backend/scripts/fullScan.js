// Manual, on-demand full-catalog scan: node scripts/fullScan.js
// Run locally with the real .env loaded — see backend/README.md.
//
// The scheduled/Vercel-triggered path (POST /api/refresh) only screens a
// rotating slice of the payload catalog per call because it has to fit in
// a 60s serverless invocation (see conjunctions.js). This script has no
// such limit, so it screens every payload against the full catalog in one
// go — useful right before/during a known event when you want the freshest
// possible active_alerts/conjunction_events without waiting on the
// rotation to reach the objects you care about.
//
// Splits the work across worker threads (one per CPU core, minus a couple
// left for the OS) instead of running single-threaded — a straight
// single-threaded run across ~16k targets was measured taking well over
// 40 minutes on real hardware (the "~37ms/target" estimate in
// conjunctions.js's comments turned out to be optimistic for a full sweep,
// closer to the ~349ms/target production rate noted there), which
// defeated the point of running this ad hoc. Parallel across N cores
// should land closer to (single-threaded time / N).
//
// It writes straight to the same Supabase tables the scheduled scan uses,
// so the frontend/API/bot all see the results immediately — no separate
// step needed.

import "dotenv/config";
import os from "node:os";
import { runConjunctionScanParallel } from "../src/conjunctions.js";

const startedAt = Date.now();
const numWorkers = Math.max(1, os.cpus().length - 2);
console.log(`Starting full catalog scan across ${numWorkers} worker threads (every payload vs the full catalog)...`);

const result = await runConjunctionScanParallel({ workerCount: numWorkers });

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `Done in ${elapsedSec}s across ${result.workerCount} workers — scanned ${result.scannedCount} targets, ` +
    `found ${result.eventsFound} close approaches, sent ${result.alertsSent} Telegram alerts.`,
);
