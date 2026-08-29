// Catalog-wide conjunction scan, run on a schedule via POST /api/refresh
// (triggered by update-tle-data.yml right after it publishes fresh TLE data).
//
// Screening every object against every other object (the frontend's
// approach, for whichever satellite a visitor happens to be looking at)
// isn't practical to also run unprompted for the whole ~19k-object catalog
// server-side — so this scans a much smaller target list instead: whatever
// is on someone's Telegram watchlist, plus a small always-on spotlight list
// so the leaderboard has content even before anyone's watching anything.
// Each target is still screened against the *entire* catalog — that's the
// same shape of work the frontend's Worker already does per tracked
// satellite, just run here on a timer instead of in a browser tab.

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
const SPOTLIGHT_NORAD_IDS = [25544]; // ISS (ZARYA) — keeps the leaderboard non-empty pre-launch

// critical > high > moderate > low, used to decide whether a repeat sighting
// of the same pair is worth alerting on again (see shouldAlert below).
const RISK_SEVERITY = { critical: 3, high: 2, moderate: 1, low: 0 };
const ALERT_MIN_SEVERITY = RISK_SEVERITY.high; // only page someone for high/critical
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function buildScreenableCatalog(objects) {
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

function findCloseApproaches(target, catalog) {
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

async function targetNoradIds() {
  const { data, error } = await supabase.from("watchlist").select("norad_id");
  if (error) throw error;

  const ids = new Set(SPOTLIGHT_NORAD_IDS);
  for (const row of data) ids.add(row.norad_id);
  return [...ids];
}

async function recordConjunctionEvents(rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("conjunction_events").insert(rows);
  if (error) throw error;
}

// Alerts only fire for high/critical risk, and only once per (watcher,
// other object) per day unless the risk has gotten worse since the last
// alert — otherwise a slow-moving multi-day conjunction would re-page the
// same person every single 2h scan.
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

async function alertWatchers(target, closeApproaches) {
  const worstByOtherId = new Map();
  for (const approach of closeApproaches) worstByOtherId.set(approach.otherNoradId, approach);
  if (worstByOtherId.size === 0) return 0;

  const { data: watchers, error } = await supabase
    .from("watchlist")
    .select("id, telegram_chat_id")
    .eq("norad_id", target.noradId);
  if (error) throw error;
  if (watchers.length === 0) return 0;

  let alertsSent = 0;
  for (const approach of worstByOtherId.values()) {
    const severity = RISK_SEVERITY[approach.riskLevel] ?? 0;

    for (const watcher of watchers) {
      if (!(await shouldAlert(watcher.id, approach.otherNoradId, severity))) continue;

      const whenLocal = approach.closestApproachAt.toUTCString();
      await sendTelegramMessage(
        watcher.telegram_chat_id,
        `⚠️ ${approach.riskLevel.toUpperCase()} risk for ${target.name} (${target.noradId}): ` +
          `predicted ${approach.distanceKm.toFixed(2)} km from ${approach.otherName} (${approach.otherNoradId}) at ${whenLocal}.`,
      );

      await supabase.from("alerts_sent").insert({
        watchlist_id: watcher.id,
        other_norad_id: approach.otherNoradId,
        risk_level: approach.riskLevel,
      });
      alertsSent++;
    }
  }
  return alertsSent;
}

export async function runConjunctionScan() {
  const catalogData = await getCatalog({ forceRefresh: true });
  const screenable = buildScreenableCatalog(catalogData.objects);
  const byNoradId = new Map(screenable.map((entry) => [entry.noradId, entry]));

  const targetIds = await targetNoradIds();
  let eventsFound = 0;
  let alertsSent = 0;

  for (const noradId of targetIds) {
    const target = byNoradId.get(noradId);
    if (!target) continue; // not in the current catalog (decayed, or a bad watch request slipped through)

    const closeApproaches = findCloseApproaches(target, screenable);
    eventsFound += closeApproaches.length;

    await recordConjunctionEvents(
      closeApproaches.map((approach) => ({
        norad_id: target.noradId,
        satellite_name: target.name,
        other_norad_id: approach.otherNoradId,
        other_name: approach.otherName,
        distance_km: approach.distanceKm,
        risk_level: approach.riskLevel,
        closest_approach_at: approach.closestApproachAt.toISOString(),
      })),
    );

    alertsSent += await alertWatchers(target, closeApproaches);
  }

  return { scannedCount: targetIds.length, eventsFound, alertsSent };
}
