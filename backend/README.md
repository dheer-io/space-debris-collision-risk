# Backend API

Express API + Telegram watchlist bot for satellite conjunction (close-approach)
data. Reads TLE data from the `tle-data` branch, screens watched satellites
against the full catalog using the same SGP4 math the frontend uses
(`shared/conjunctionMath.js`), stores results in Supabase, and messages
watchers on Telegram when a watched satellite's risk goes high/critical.

See the root [`README`](../README.md) for the rest of the project. Everything
below is specific to this directory.

## Endpoints

| Route | Method | What it does |
| --- | --- | --- |
| `/api/health` | GET | Liveness check |
| `/api/satellites/:noradId` | GET | TLE + basic info for one object |
| `/api/satellites/:noradId/conjunctions` | GET | Latest computed close approaches for one object |
| `/api/leaderboard` | GET | Closest predicted approaches across everything currently scanned |
| `/api/refresh` | POST | Re-fetches TLE data, rescans, sends alerts. Requires `x-refresh-secret` header. Called by `update-tle-data.yml`, not meant to be public. |
| `/api/telegram/webhook` | POST | Telegram calls this on every message. Requires Telegram's `x-telegram-bot-api-secret-token` header. |

## One-time setup

1. **Database.** In the Supabase dashboard: SQL Editor -> New query -> paste
   and run [`db/schema.sql`](db/schema.sql).
2. **Telegram bot.** Message [@BotFather](https://t.me/BotFather) on
   Telegram, `/newbot`, follow the prompts, copy the token it gives you.
3. **Local env.** `cp .env.example .env` and fill in the real values
   (Supabase project URL + secret key from Project Settings -> API, the bot
   token from step 2, and make up random strings for the two `*_SECRET`
   values).
4. **Install + run locally:**
   ```
   npm install
   npm start
   ```
5. **Deploy — Vercel.** vercel.com -> Add New -> Project -> import this repo.
   When it asks for the **Root Directory**, set it to `backend` (not the repo
   root — this directory has its own `package.json`, `api/`, and
   `vercel.json`). Framework preset: "Other". Then, in the project's
   Settings -> Environment Variables, add the same five values from your
   `.env` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `REFRESH_SECRET`) — Vercel doesn't read `.env`
   files from the repo, only variables set in the dashboard. Redeploy after
   adding them (env var changes don't apply to a deployment already running).
6. **Point the Telegram bot at the deployed URL:**
   ```
   node scripts/setWebhook.js https://<your-project>.vercel.app
   ```
   Re-run this any time the deployed URL changes (e.g. after a production
   domain is assigned).
7. **Wire up the scheduled rescan.** In the GitHub repo: Settings -> Secrets
   and variables -> Actions, add `API_BASE_URL` (your Vercel URL, no
   trailing slash) and `REFRESH_SECRET` (same value as in the backend's
   env). Once both are set, `update-tle-data.yml` will call
   `POST /api/refresh` after every fetch — until then it just skips that
   step, so the TLE fetch/deploy pipeline keeps working with or without the
   backend.

## Notes on the design

- **Why only watched satellites get scanned, not the whole ~19k-object
  catalog:** screening one satellite against the full catalog is exactly
  what the frontend's Worker already does per tracked satellite, so it's
  known to be cheap. Screening *every* object against *every other* object
  server-side is a much bigger job (~19k²) with nothing pulling the results
  — nobody's watching most of it. `conjunctions.js` scans the watchlist
  (plus a small always-on "spotlight" list so the leaderboard has content
  even before anyone watches anything) against the full catalog, not the
  full catalog against itself.
- **Why alerts don't repeat every 2h:** a genuine close approach a few days
  out will still look high-risk on the next several scans. `conjunctions.js`
  only re-alerts a watcher about the same object pair if the risk level has
  gotten worse since the last alert, or 24h have passed.
- **Why Vercel over a long-running host:** it's serverless — no persistent
  process, no idle spin-down to work around, no card required for the free
  Hobby tier (unlike most "free" long-running-container hosts). The
  trade-off is the in-memory TLE cache in `tle.js` only lives for the
  duration of one function invocation instead of persisting between
  requests, but since `/api/refresh` always force-refreshes it anyway,
  that's a non-issue for the one thing that actually needs fresh data.
