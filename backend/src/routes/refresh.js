import { Router } from "express";
import { env } from "../env.js";
import { runConjunctionScan } from "../conjunctions.js";

export const refreshRouter = Router();

// Called by update-tle-data.yml right after it publishes fresh TLE data.
// Protected by a shared secret rather than anything user-facing — this
// endpoint does real, non-idempotent work (writes rows, sends Telegram
// messages), so it shouldn't be triggerable by just anyone who finds the URL.
refreshRouter.post("/", async (req, res, next) => {
  try {
    if (req.get("x-refresh-secret") !== env.refreshSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const summary = await runConjunctionScan();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});
