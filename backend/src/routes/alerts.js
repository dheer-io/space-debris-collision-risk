import { Router } from "express";
import { supabase } from "../db.js";

export const alertsRouter = Router();

// The live critical-risk set — see active_alerts in db/schema.sql. Unlike a
// stored-history read, this table is actively kept in sync by
// runConjunctionScan(): a pair sitting in here is critical as of the most
// recent scan that covered it, not just "was critical at some point in the
// last few hours."
alertsRouter.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("active_alerts")
      .select("norad_id, satellite_name, other_norad_id, other_name, distance_km, risk_level, closest_approach_at, first_seen_at, last_seen_at")
      .order("distance_km", { ascending: true });
    if (error) throw error;

    res.json({ alerts: data });
  } catch (error) {
    next(error);
  }
});
