import { Router } from "express";
import { supabase } from "../db.js";

export const leaderboardRouter = Router();

const RECENCY_WINDOW_MS = 3 * 60 * 60 * 1000; // a bit above the 2h scan cadence
const DEFAULT_LIMIT = 20;

// Closest predicted approaches across everything scanned recently (the
// watchlist + spotlight + that scan's rotating slice of the catalog — see
// conjunctions.js). Two filters, not one: computed_at bounds it to roughly
// the last scan cycle, and closest_approach_at excludes anything whose
// predicted encounter has already happened — a close approach from three
// hours ago is history, not a "current" risk, even if it was computed
// recently. For "what's high/critical right now specifically," see
// /api/alerts instead, which is actively maintained rather than time-
// windowed.
leaderboardRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 100);
    const since = new Date(Date.now() - RECENCY_WINDOW_MS).toISOString();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("conjunction_events")
      .select("norad_id, satellite_name, other_norad_id, other_name, distance_km, risk_level, closest_approach_at, computed_at")
      .gte("computed_at", since)
      .gte("closest_approach_at", now)
      .order("distance_km", { ascending: true })
      .limit(limit);
    if (error) throw error;

    res.json({ events: data });
  } catch (error) {
    next(error);
  }
});
