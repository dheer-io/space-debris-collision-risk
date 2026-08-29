import { Router } from "express";
import { supabase } from "../db.js";

export const leaderboardRouter = Router();

const RECENCY_WINDOW_MS = 3 * 60 * 60 * 1000; // a bit above the 2h scan cadence
const DEFAULT_LIMIT = 20;

// Closest predicted approaches across everything currently being scanned
// (watchlist + spotlight — see conjunctions.js), most recent scan only.
leaderboardRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 100);
    const since = new Date(Date.now() - RECENCY_WINDOW_MS).toISOString();

    const { data, error } = await supabase
      .from("conjunction_events")
      .select("norad_id, satellite_name, other_norad_id, other_name, distance_km, risk_level, closest_approach_at, computed_at")
      .gte("computed_at", since)
      .order("distance_km", { ascending: true })
      .limit(limit);
    if (error) throw error;

    res.json({ events: data });
  } catch (error) {
    next(error);
  }
});
