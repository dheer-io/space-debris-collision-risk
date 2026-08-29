import { Router } from "express";
import { getCatalog, findObject } from "../tle.js";
import { supabase } from "../db.js";

export const satellitesRouter = Router();

satellitesRouter.get("/:noradId", async (req, res, next) => {
  try {
    const noradId = Number(req.params.noradId);
    if (!Number.isInteger(noradId)) return res.status(400).json({ error: "noradId must be an integer" });

    const catalog = await getCatalog();
    const object = findObject(catalog, noradId);
    if (!object) return res.status(404).json({ error: "Not found in the current catalog" });

    res.json({ ...object, catalog_fetched_at: catalog.fetchedAt });
  } catch (error) {
    next(error);
  }
});

// Latest computed close approaches for one satellite. Reads from the table
// runConjunctionScan() writes to — this endpoint never computes live, so
// it's only ever as fresh as the last /api/refresh run.
satellitesRouter.get("/:noradId/conjunctions", async (req, res, next) => {
  try {
    const noradId = Number(req.params.noradId);
    if (!Number.isInteger(noradId)) return res.status(400).json({ error: "noradId must be an integer" });

    const { data: latest, error: latestError } = await supabase
      .from("conjunction_events")
      .select("computed_at")
      .eq("norad_id", noradId)
      .order("computed_at", { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    if (latest.length === 0) return res.json({ computed_at: null, events: [] });

    const { data: events, error } = await supabase
      .from("conjunction_events")
      .select("other_norad_id, other_name, distance_km, risk_level, closest_approach_at")
      .eq("norad_id", noradId)
      .eq("computed_at", latest[0].computed_at)
      .order("distance_km", { ascending: true });
    if (error) throw error;

    res.json({ computed_at: latest[0].computed_at, events });
  } catch (error) {
    next(error);
  }
});
