// In-memory cache of the TLE catalog fetched from the tle-data branch. The
// catalog only actually changes once per update-tle-data.yml run (every 2h),
// so there's no need to hit GitHub on every request — only when the cache is
// missing, stale, or a caller explicitly wants a fresh copy (the /api/refresh
// scan, which is the one place staleness would matter).

import { env } from "./env.js";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // matches the fetch workflow's own cadence

// Node's fetch has no default timeout — a blocked/blackholed connection can
// hang on the OS's own TCP timeout (60-130+s) instead of failing fast. Same
// reasoning as fetchTleData.js's own FETCH_TIMEOUT_MS.
const FETCH_TIMEOUT_MS = 10_000;

let cache = null; // { objects, fetchedAt, cachedAtMs }

export async function getCatalog({ forceRefresh = false } = {}) {
  const isStale = !cache || Date.now() - cache.cachedAtMs > CACHE_TTL_MS;
  if (!forceRefresh && !isStale) return cache;

  try {
    const response = await fetch(env.tleDataUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    cache = { objects: data.objects, fetchedAt: data.fetched_at, cachedAtMs: Date.now() };
    return cache;
  } catch (error) {
    // A timeout, DNS failure, or connection reset is just as much a fetch
    // failure as a bad HTTP status — serve the stale copy rather than fail
    // outright, same as the !response.ok case above.
    if (cache) return cache;
    throw new Error(`Failed to fetch TLE data: ${error.message}`);
  }
}

export function findObject(catalog, noradId) {
  return catalog.objects.find((object) => object.norad_id === noradId) ?? null;
}

// Case-insensitive substring match on name, or an exact NORAD ID if the
// query is purely numeric. Used by the Telegram /watch command, where users
// type either "25544" or "ISS".
export function searchCatalog(catalog, query) {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const object = findObject(catalog, Number(trimmed));
    return object ? [object] : [];
  }

  const needle = trimmed.toLowerCase();
  return catalog.objects.filter((object) => object.name.toLowerCase().includes(needle));
}
