# Space Debris Tracking & Satellite Collision Risk Prediction

**PS-04** — A browser-based dashboard for tracking satellites/debris and predicting close-approach collision risk from live orbital data, by Group 6Gs.

https://dheer-io.github.io/space-debris-collision-risk/frontend/html_css/index.html

## Features

- Live 3D globe (Three.js/WebGPU) with SGP4-propagated satellite positions, searchable across a ~19,000-object catalog
- Track up to 8 objects at once, scrub their positions up to 5h into the future, and plot distance-over-time for any of them
- Collision risk screening (tracked satellites vs. the full catalog) with Critical/High/Moderate/Low bands, run off the main thread in a Web Worker
- Close-approach browser for what you're tracking, plus a catalog-wide critical-alerts feed computed server-side — not limited to what you happen to be tracking in this tab
- Two dashboard layouts (docked / full) via the header's status-bar controls
- Telegram bot ([@space_debris_alert_bot](https://t.me/space_debris_alert_bot)): `/watch`, `/unwatch`, `/list`, `/lookup`, `/alerts` — get pinged directly when something you're watching heads into critical range, no need to keep the site open

## How it works

```
CelesTrak
  |  backend/fetchTleData.js, via GitHub Actions every 2h
  v
tle-data branch (data/raw/tle-latest.json)
  |
  |---> GitHub Pages rebuild --> frontend: client-side SGP4 propagation +
  |                               risk screening (Three.js globe, Web Worker)
  |
  '---> POST /api/refresh --> backend (Express on Vercel): rescans the
                                watchlist + a rotating slice of the catalog
                                  |
                                  v
                          Supabase (active_alerts, conjunction_events, watchlist)
                                  |
                    +-------------+--------------+
                    v                             v
           GET /api/alerts                 Telegram push
           (polled by the frontend)        (to anyone watching)
```

Tracking, risk assessment, and close-approach browsing all run entirely client-side — the frontend works even if the backend is completely down. The backend exists specifically for the catalog-wide Alerts feed and the Telegram bot, both of which need to keep working independent of whether anyone has the site open.

A failed or partial CelesTrak fetch (rejected below 10,000 objects — a healthy catalog is ~19,000) never touches the `tle-data` branch, so the frontend, backend, and Telegram bot always agree on the same last-known-good snapshot; see `backend/fetchTleData.js` and `.github/workflows/update-tle-data.yml`.

## Project layout

- `frontend/` — the static site (`html_css/`, `js/`, `geojson/` basemap data), deployed to GitHub Pages
- `backend/` — Express API, deployed to Vercel as a single serverless function
  - `src/app.js` — routes: `/api/health`, `/api/satellites/:noradId`, `/api/satellites/:noradId/conjunctions`, `/api/alerts`, `/api/refresh`, `/api/telegram/webhook`
  - `src/conjunctions.js` — the scan: watchlist + an ISS spotlight + a time-rotated slice of the catalog, screened against each other every run
  - `src/telegram.js`, `src/routes/telegram.js` — the bot itself
  - `db/schema.sql` — Supabase Postgres schema (run once manually in the SQL editor — no migration runner)
  - `fetchTleData.js` — pulls TLEs from CelesTrak, run by `.github/workflows/update-tle-data.yml`
  - `vercel.json` — deploy config; also disables Vercel Preview builds on the `tle-data` branch (see Deployment below)
- `shared/conjunctionMath.js` — orbital math and risk-band thresholds, imported by both frontend and backend so the two never disagree on what counts as "critical"
- `data/raw/tle-latest.json` — the catalog snapshot, committed to the orphan `tle-data` branch, never to `main`
- `tests/fetch-tle.smoke.js` — sanity-checks the CelesTrak fetch against every configured group without writing any files

## Running locally

Frontend (static, no build step):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/frontend/html_css/index.html`.

Backend (optional — only needed for the Alerts feed, the Telegram bot, and conjunction scanning; the globe and tracking work fine without it):

```bash
cd backend
npm install
cp .env.example .env   # fill in your own Supabase + Telegram credentials
# run backend/db/schema.sql once in the Supabase SQL editor
npm start
```

## Deployment

- **Frontend** — GitHub Pages, rebuilt by `.github/workflows/deploy-pages.yml` on every push to `main` and after every successful TLE fetch.
- **Backend** — Vercel, deployed from `main`. The `tle-data` branch is an orphan branch holding only `data/raw/tle-latest.json` (no backend code at all), so `backend/vercel.json`'s `git.deploymentEnabled` explicitly disables builds for it — otherwise every scheduled push to that branch would trigger a guaranteed-to-fail Preview deployment.
- **Data refresh** — `.github/workflows/update-tle-data.yml`, every 2h: fetches CelesTrak, commits to `tle-data` only if the catalog looks complete, triggers the GitHub Pages rebuild, and tells the backend to rescan. That last step runs even when the fetch itself failed or was rejected as partial, so alerts keep updating against the last good snapshot instead of freezing until CelesTrak recovers.
- **Alert rescans** — `.github/workflows/refresh-alerts.yml`, every 15 min: just calls `POST /api/refresh` again, independent of the TLE fetch above. The backend can't screen the whole ~16k-payload catalog in one 60s serverless invocation, so each scan only covers the Telegram watchlist + ISS + a rotating ~60-object slice (see `backend/src/conjunctions.js`); the slice is tracked by a persisted cursor (`scan_state` table) rather than wall-clock time, so calling refresh more often genuinely shortens how long a full catalog sweep takes (~2.8 days at this cadence) instead of just rescanning the same slice repeatedly.

## Tech

**Frontend** — Three.js (WebGPU) · satellite.js (SGP4/SDP4) · Web Workers
**Backend** — Express · Supabase (Postgres) · Telegram Bot API · Vercel
**Automation** — GitHub Actions
