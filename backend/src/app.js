import express from "express";
import { satellitesRouter } from "./routes/satellites.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { refreshRouter } from "./routes/refresh.js";
import { telegramRouter } from "./routes/telegram.js";

export const app = express();

app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/satellites", satellitesRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/refresh", refreshRouter);
app.use("/api/telegram", telegramRouter);

// Centralized error handler — every route's async work is wrapped in
// try/catch + next(error), so this is the one place that turns any of them
// into a response instead of a hung request.
app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

// Vercel's Node builder validates every file it traces from api/index.js
// (not just the entry itself) for a callable default export — this file
// only had the named `app` export, which api/index.js re-exports as
// default, and that wasn't enough to satisfy the check on app.js itself.
// Exporting it here too costs nothing and settles it either way.
export default app;
