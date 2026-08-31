// Catalog-wide conjunction scan, run on a schedule via POST /api/refresh
// (triggered by update-tle-data.yml right after it publishes fresh TLE data).
//
// Screening the ENTIRE catalog against itself (~19k objects, ~19k^2 pairs)
// isn't feasible in one serverless invocation — measured locally at ~37ms
// per target once JIT-warmed, so even a few hundred targets is comfortably
// fast (400 targets ~= 15s), but all ~16k payload objects would take
// several minutes, well past any realistic function timeout.
//
// Instead: every scan always covers the Telegram watchlist + a small fixed
// spotlight, PLUS a rotating slice of the wider payload catalog. Which slice
// rotates is driven by a cursor persisted in the scan_state table (one row,
// advanced by one batch per successful call) rather than derived from
// wall-clock time — that way calling /api/refresh more often genuinely
// speeds up how fast the whole catalog gets covered, instead of just
// rescanning the same time-bucketed slice over and over (see pickTargetIds
// and getAndAdvanceRotationCounter).
import {
  createSatrec,
  orbitalAltitudeBand,
  altitudeBandsCouldOverlap,
  findMinSeparation,
  riskForDistanceKm,
  CONJUNCTION_SCREEN_KM,
} from "../../shared/conjunctionMath.js";
import { getCatalog } from "./tle.js";
import { supabase } from "./db.js";
import { sendTelegramMessage } from "./telegram.js";

const SCREEN_WINDOW_MINUTES = 5 * 60; // same look-ahead window the frontend uses
const SPOTLIGHT_NORAD_IDS = [25544]; // ISS (ZARYA) — always scanned, watched or not

// sendTelegramMessage now always sends parse_mode: "HTML" — satellite names
// come from CelesTrak and are untrusted-ish, so anything interpolated into
// a message needs this (same reasoning as routes/telegram.js's own copy).
function htmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 400 timed out for real in production. 150 measured at 52.7s in
// production for 151 targets (~349ms/target — nearly 9x the ~37ms/target
// measured on local compute, which is what 400 and then 150 were both
// wrongly sized from) — only ~7s under the 60s hard cap, not a safe
// margin. This is sized from that real production rate instead:
// 60 * ~349ms =~ 21s of scan time, leaving real headroom under 60s even
// accounting for run-to-run variance (cold starts, catalog fetch, the
// fixed active_alerts cleanup/expire queries). Better to rotate through
// the catalog slower than to risk timing out and silently skipping an
// entire cycle.
const ROTATION_BATCH_SIZE = 60;

// critical > high > moderate > low, used to decide whether a repeat sighting
// of the same pair is worth alerting on again (see shouldAlert below).
const RISK_SEVERITY = { critical: 3, high: 2, moderate: 1, low: 0 };
// Raised from "high" to "critical only" — high+critical together were too
// noisy for what's meant to be a short, genuinely-urgent list (both for the
// Telegram push and for active_alerts/the frontend's live alert feed).
const ALERT_MIN_SEVERITY = RISK_SEVERITY.critical;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Exported for the Telegram /lookup command, which runs this same
// single-target scan live and on-demand rather than reading stored results
// — a rotation-batch target might not have been scanned recently, but any
// object should be look-up-able right now.
export function buildScreenableCatalog(objects) {
  const entries = [];
  for (const object of objects) {
    const satrec = createSatrec(object.line1, object.line2);
    if (!satrec) continue; // malformed/unusable elements — skip rather than crash the scan
    entries.push({
      noradId: object.norad_id,
      name: object.name,
      type: object.type,
      satrec,
      band: orbitalAltitudeBand(satrec),
    });
  }
  return entries;
}

export function findCloseApproaches(target, catalog) {
  const fromDate = new Date();
  const closeApproaches = [];

  for (const other of catalog) {
    if (other.noradId === target.noradId) continue;
    if (!altitudeBandsCouldOverlap(target.band, other.band, CONJUNCTION_SCREEN_KM)) continue;

    const result = findMinSeparation(target.satrec, other.satrec, fromDate, SCREEN_WINDOW_MINUTES);
    if (!result) continue;

    const risk = riskForDistanceKm(result.distanceKm);
    if (!risk) continue;

    closeApproaches.push({
      otherNoradId: other.noradId,
      otherName: other.name,
      distanceKm: result.distanceKm,
      riskLevel: risk.level,
      closestApproachAt: result.atDate,
    });
  }

  return closeApproaches.sort((a, b) => a.distanceKm - b.distanceKm);
}

// Watchlist + spotlight are scanned every single run; everything else is a
// rotating slice of the payload catalog (debris/unknown objects are targets'
// *counterparts*, not targets themselves — nobody watches debris). Driven by
// a persisted rotationCounter (see getAndAdvanceRotationCounter) rather than
// wall-clock time, so a missed run just means that slice's turn comes around
// on the next call instead of drifting, AND calling refresh more often
// actually covers the catalog faster.
function pickTargetIds(catalogObjects, watchlistNoradIds, rotationCounter) {
  const ids = new Set(SPOTLIGHT_NORAD_IDS);
  for (const id of watchlistNoradIds) ids.add(id);

  const payloadIds = catalogObjects.filter((object) => object.type === "payload").map((object) => object.norad_id);
  if (payloadIds.length > 0) {
    const totalBatches = Math.ceil(payloadIds.length / ROTATION_BATCH_SIZE);
    const batchIndex = rotationCounter % totalBatches;
    const start = batchIndex * ROTATION_BATCH_SIZE;
    for (const id of payloadIds.slice(start, start + ROTATION_BATCH_SIZE)) ids.add(id);
  }

  return [...ids];
}

// Reads scan_state's rotation counter and advances it for the next call, in
// one round trip's worth of work. If scan_state hasn't been created yet
// (schema.sql not re-run since this was added), falls back to the old
// wall-clock-derived value instead of throwing — degraded (same slice
// rescanned within each 2h bucket) but not broken.
async function getAndAdvanceRotationCounter() {
  const { data, error } = await supabase.from("scan_state").select("rotation_counter").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to read scan_state (has schema.sql been re-run?):", error);
    return Math.floor(Date.now() / (2 * 60 * 60 * 1000));
  }

  const counter = data.rotation_counter;
  const { error: updateError } = await supabase
    .from("scan_state")
    .update({ rotation_counter: counter + 1, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (updateError) console.error("Failed to advance scan_state rotation_counter:", updateError);

  return counter;
}

// Alerts only fire for critical risk, and only once per (watcher,
// other object) per day unless the risk has gotten worse since the last
// alert — otherwise a slow-moving multi-day conjunction would re-page the
// same person every single 2h scan. Watchlist sizes are small (a handful
// of chat/satellite pairs), so per-approach lookups here are fine — this
// is not run for the hundreds of un-watched rotation targets.
async function shouldAlert(watchlistId, otherNoradId, severity) {
  if (severity < ALERT_MIN_SEVERITY) return false;

  const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();
  const { data, error } = await supabase
    .from("alerts_sent")
    .select("risk_level")
    .eq("watchlist_id", watchlistId)
    .eq("other_norad_id", otherNoradId)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  if (data.length === 0) return true;
  const lastSeverity = RISK_SEVERITY[data[0].risk_level] ?? 0;
  return severity > lastSeverity; // only re-alert if things got worse
}

async function alertWatchers(target, closeApproaches, watchers) {
  if (watchers.length === 0) return 0;
  const criticalApproaches = closeApproaches.filter((a) => (RISK_SEVERITY[a.riskLevel] ?? 0) >= ALERT_MIN_SEVERITY);
  if (criticalApproaches.length === 0) return 0;

  let alertsSent = 0;
  for (const approach of criticalApproaches) {
    const severity = RISK_SEVERITY[approach.riskLevel] ?? 0;

    for (const watcher of watchers) {
      if (!(await shouldAlert(watcher.id, approach.otherNoradId, severity))) continue;

      // One watcher's bad chat id (bot blocked, chat deleted, ...) or a
      // one-off insert failure shouldn't take down the rest of the scan —
      // every other target/watcher still needs to run. Log and move on.
      try {
        const whenLocal = approach.closestApproachAt.toUTCString();
        await sendTelegramMessage(
          watcher.telegram_chat_id,
          `⚠️ <b>${approach.riskLevel.toUpperCase()} RISK</b>\n\n` +
            `<b>${htmlEscape(target.name)}</b> <code>#${target.noradId}</code>\n` +
            `vs\n` +
            `<b>${htmlEscape(approach.otherName)}</b> <code>#${approach.otherNoradId}</code>\n\n` +
            `📏 Distance: <b>${approach.distanceKm.toFixed(2)} km</b>\n` +
            `🕒 When: ${whenLocal}`,
        );

        // Recorded even if this throws below wouldn't help — if this insert
        // itself fails, log it loudly: silently losing it means shouldAlert()
        // never sees the alert and re-pages this watcher every future scan.
        const { error: insertError } = await supabase.from("alerts_sent").insert({
          watchlist_id: watcher.id,
          other_norad_id: approach.otherNoradId,
          risk_level: approach.riskLevel,
        });
        if (insertError) throw insertError;

        alertsSent++;
      } catch (error) {
        console.error(`Failed to alert watcher ${watcher.id} about ${approach.otherNoradId}:`, error);
      }
    }
  }
  return alertsSent;
}

export async function runConjunctionScan() {
  const catalogData = await getCatalog({ forceRefresh: true });
  const screenable = buildScreenableCatalog(catalogData.objects);
  const byNoradId = new Map(screenable.map((entry) => [entry.noradId, entry]));

  const { data: watchlistRows, error: watchlistError } = await supabase
    .from("watchlist")
    .select("id, telegram_chat_id, norad_id");
  if (watchlistError) throw watchlistError;

  const watchersByNoradId = new Map();
  for (const row of watchlistRows) {
    if (!watchersByNoradId.has(row.norad_id)) watchersByNoradId.set(row.norad_id, []);
    watchersByNoradId.get(row.norad_id).push(row);
  }

  const rotationCounter = await getAndAdvanceRotationCounter();
  const targetIds = pickTargetIds(
    catalogData.objects,
    watchlistRows.map((row) => row.norad_id),
    rotationCounter,
  );

  // Every Supabase write below is batched into ONE call across all targets
  // instead of one call per target — at up to ~400 targets, per-target
  // round trips would dominate the whole request's time budget far more
  // than the actual SGP4 math does.
  const conjunctionRows = [];
  const activeAlertRows = [];
  const currentAlertKeysByTarget = new Map(); // noradId -> Set<otherNoradId> currently critical

  let eventsFound = 0;
  let alertsSent = 0;

  for (const noradId of targetIds) {
    const target = byNoradId.get(noradId);
    if (!target) continue; // not in the current catalog (decayed, or a bad watch request slipped through)

    const closeApproaches = findCloseApproaches(target, screenable);
    eventsFound += closeApproaches.length;

    for (const approach of closeApproaches) {
      conjunctionRows.push({
        norad_id: target.noradId,
        satellite_name: target.name,
        other_norad_id: approach.otherNoradId,
        other_name: approach.otherName,
        distance_km: approach.distanceKm,
        risk_level: approach.riskLevel,
        closest_approach_at: approach.closestApproachAt.toISOString(),
      });
    }

    const criticalApproaches = closeApproaches.filter((a) => (RISK_SEVERITY[a.riskLevel] ?? 0) >= ALERT_MIN_SEVERITY);
    currentAlertKeysByTarget.set(target.noradId, new Set(criticalApproaches.map((a) => a.otherNoradId)));
    for (const approach of criticalApproaches) {
      activeAlertRows.push({
        norad_id: target.noradId,
        satellite_name: target.name,
        other_norad_id: approach.otherNoradId,
        other_name: approach.otherName,
        distance_km: approach.distanceKm,
        risk_level: approach.riskLevel,
        closest_approach_at: approach.closestApproachAt.toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }

    const watchers = watchersByNoradId.get(target.noradId) ?? [];
    if (watchers.length > 0) {
      alertsSent += await alertWatchers(target, closeApproaches, watchers);
    }
  }

  if (conjunctionRows.length > 0) {
    const { error } = await supabase.from("conjunction_events").insert(conjunctionRows);
    if (error) console.error("Failed to record conjunction_events:", error);
  }

  if (activeAlertRows.length > 0) {
    const { error } = await supabase
      .from("active_alerts")
      .upsert(activeAlertRows, { onConflict: "norad_id,other_norad_id" });
    if (error) console.error("Failed to upsert active_alerts:", error);
  }

  // A pair that no longer shows up as critical for a target we DID
  // rescan this round (cooled off, or dropped out of range entirely) needs
  // its stale active_alerts row removed — one read + one delete, not one
  // per target.
  if (targetIds.length > 0) {
    const { data: existingAlerts, error: existingError } = await supabase
      .from("active_alerts")
      .select("id, norad_id, other_norad_id")
      .in("norad_id", targetIds);

    if (existingError) {
      console.error("Failed to read active_alerts for cleanup:", existingError);
    } else {
      const staleIds = existingAlerts
        .filter((row) => !(currentAlertKeysByTarget.get(row.norad_id) ?? new Set()).has(row.other_norad_id))
        .map((row) => row.id);

      if (staleIds.length > 0) {
        const { error: deleteError } = await supabase.from("active_alerts").delete().in("id", staleIds);
        if (deleteError) console.error("Failed to clean up stale active_alerts:", deleteError);
      }
    }
  }

  // Global safety net: an alert whose predicted closest approach has simply
  // passed is moot regardless of whether its target got rescanned this
  // round (e.g. it rotated out of this cycle's batch, or was unwatched).
  const { error: expireError } = await supabase
    .from("active_alerts")
    .delete()
    .lt("closest_approach_at", new Date().toISOString());
  if (expireError) console.error("Failed to expire active_alerts:", expireError);

  return { scannedCount: targetIds.length, eventsFound, alertsSent };
}
