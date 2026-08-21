# Space Debris Tracking & Satellite Collision Risk Prediction

**PS-04** — A browser-based dashboard for tracking satellites/debris and predicting close-approach collision risk from live orbital data, by Group 6Gs.

https://dheer-io.github.io/space-debris-collision-risk/frontend/html_css/index.html

## Features

- Live 3D globe (Three.js/WebGPU) with SGP4-propagated satellite positions, searchable across a ~19,000-object catalog
- Track up to 8 objects at once, scrub their positions up to 5h into the future
- Collision risk screening (tracked satellites vs. the full catalog) with Critical/High/Moderate/Low bands, run off the main thread in a Web Worker
- Close-approach browser and a standing alerts feed for high-risk conjunctions

## How it works

```
CelesTrak TLE data
   ↓ (backend/fetchTleData.js, scheduled every 3h via GitHub Actions)
data/raw/tle-latest.json
   ↓
Frontend: SGP4 propagation (satellite.js) + conjunction screening (Web Worker)
   ↓
3D globe + risk dashboard
```

Everything runs client-side — there's no application backend. `backend/` only holds the scheduled data-fetch script.

## Project layout

- `frontend/` — the app (`html_css/`, `js/`, `geojson/` basemap data)
- `backend/fetchTleData.js` — pulls TLEs from CelesTrak, run by `.github/workflows/update-tle-data.yml`
- `data/raw/tle-latest.json` — the catalog the frontend fetches at runtime
- `tests/fetch-tle.smoke.js` — sanity-checks the CelesTrak fetch

## Running locally

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/frontend/html_css/index.html`.

## Tech

Three.js (WebGPU) · satellite.js (SGP4/SDP4) · Web Workers · Node.js · GitHub Actions
