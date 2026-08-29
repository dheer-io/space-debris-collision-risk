// Writes data/raw/tle-latest.json: { fetched_at, object_count, objects:
// [{ name, norad_id, type, line1, line2 }] }. Frontend fetches this file
// directly — do not change the output path.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.resolve(__dirname, "..", "data", "raw", "tle-latest.json");

const GROUPS = [
  { name: "active", type: "payload" }, // ~16,000 objects — the bulk of the catalog
  { name: "stations", type: "payload" }, // overlaps "active", dedup handles it
  { name: "visual", type: "payload" }, // brightest/largest objects
  { name: "analyst", type: "unknown" }, // tracked but not fully catalogued
  { name: "last-30-days", type: "payload" }, // recent launches
  { name: "cosmos-2251-debris", type: "debris" },
  { name: "iridium-33-debris", type: "debris" },
  { name: "fengyun-1c-debris", type: "debris" },
  { name: "cosmos-1408-debris", type: "debris" },
  // "russian-asat-debris" isn't a real CelesTrak group (returns an error
  // page, not TLE data) — verified via tests/fetch-tle.smoke.js.
];

// Node's fetch() sends no User-Agent by default; CelesTrak is more likely to treat that as a bot.
const USER_AGENT = "space-debris-collision-risk-fetch-tle/1.0";

// CelesTrak has documented periodic outages and blocks IPs (including
// shared cloud/datacenter ranges — which is exactly what a GitHub Actions
// runner is) that generate too many errors. A couple of short retries
// costs nothing and recovers a transient connection blip; it won't help
// during an actual multi-minute outage or a sustained IP block, which is
// a CelesTrak-side condition no amount of client-side retrying fixes.
const FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
// Node's fetch has NO default timeout — a blocked/blackholed connection
// (exactly what an IP-level block looks like, as opposed to a fast
// "connection refused") can hang on the OS's own TCP connect timeout,
// which is often 60-130+ seconds. Without this, 9 groups x 3 attempts each
// could take the better part of an hour to all fail, instead of the ~4.5
// minutes worst case this bounds it to.
const FETCH_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGroup(group) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group.name}&FORMAT=tle`;

  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        // CelesTrak rate-limits to once per 2h and returns 403 if polled
        // sooner — expected on a re-run, not a bug (the scheduled workflow
        // stays above 2h). Retrying won't fix a 403, so fail immediately.
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      if (!text.includes("\n1 ")) {
        throw new Error("response doesn't look like TLE data (bad group name or login-gated?)");
      }

      return parseTle(text, group.type);
    } catch (error) {
      lastError = error;
      // A real HTTP response (even an error one) means CelesTrak is up and
      // responding — retrying the exact same request won't change that.
      // Only retry on network-level failures (connection refused/timed
      // out/reset), where a transient blip is actually plausible.
      if (error.message.startsWith("HTTP ") || error.message.startsWith("response doesn't look like")) break;
    }
  }
  throw lastError;
}

// A TLE record is 3 lines: name, line 1, line 2. The only thing we pull out
// is the NORAD ID (needed to dedupe objects that appear in more than one
// group) — line1/line2 are kept exactly as CelesTrak sent them.
function parseTle(text, type) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const objects = [];

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const line1 = lines[i + 1].trim();
    const line2 = lines[i + 2].trim();
    const isValidPair = line1.startsWith("1 ") && line2.startsWith("2 ");
    if (!isValidPair) continue;

    objects.push({
      name: lines[i].trim(),
      norad_id: Number(line1.slice(2, 7)),
      type,
      line1,
      line2,
    });
  }

  return objects;
}

async function run() {
  const objectsByNoradId = new Map();

  for (const group of GROUPS) {
    try {
      const objects = await fetchGroup(group);
      objects.forEach((object) => objectsByNoradId.set(object.norad_id, object));
      console.log(`${group.name}: ${objects.length} objects`);
    } catch (error) {
      console.warn(`${group.name} skipped: ${error.message}`);
    }
  }

  const objects = [...objectsByNoradId.values()];

  // A failed run must never wipe out the last good dataset.
  if (objects.length === 0) {
    throw new Error("Fetched zero objects from every group — leaving existing data untouched.");
  }

  const output = {
    fetched_at: new Date().toISOString(),
    object_count: objects.length,
    objects,
  };

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote ${objects.length} objects to ${OUTPUT_FILE}`);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { run, fetchGroup, parseTle, GROUPS };
