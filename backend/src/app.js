import express from "express";
import cors from "cors";
import { satellitesRouter } from "./routes/satellites.js";
import { alertsRouter } from "./routes/alerts.js";
import { refreshRouter } from "./routes/refresh.js";
import { telegramRouter } from "./routes/telegram.js";

export const app = express();

// This is meant to be a public read API (that's the point — see
// /api/satellites and /api/alerts), so browsers on other origins need
// to be able to read the response. The two POST routes don't rely on
// cookies/sessions for auth (they check a shared-secret header instead),
// so a permissive CORS policy doesn't weaken them.
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "space-debris-collision-risk API",
    docs: "https://github.com/dheer-io/space-debris-collision-risk/blob/main/backend/README.md",
    endpoints: ["/api/health", "/api/satellites/:noradId", "/api/satellites/:noradId/conjunctions", "/api/alerts"],
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/satellites", satellitesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/refresh", refreshRouter);
app.use("/api/telegram", telegramRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

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
