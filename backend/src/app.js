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
