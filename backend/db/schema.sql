-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query) before the backend's first request. Not applied automatically —
-- there's no migration runner here, this is a one-shot hackathon schema.

create table if not exists watchlist (
  id bigint generated always as identity primary key,
  telegram_chat_id bigint not null,
  norad_id integer not null,
  satellite_name text not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, norad_id)
);

-- One row per (target, other object) close approach found on a given scan.
-- Rows accumulate over time on purpose — this is also the history a future
-- "risk over time" chart would read from, not just the latest snapshot.
create table if not exists conjunction_events (
  id bigint generated always as identity primary key,
  norad_id integer not null,
  satellite_name text not null,
  other_norad_id integer not null,
  other_name text not null,
  distance_km double precision not null,
  risk_level text not null,
  closest_approach_at timestamptz not null,
  computed_at timestamptz not null default now()
);

create index if not exists conjunction_events_norad_id_idx
  on conjunction_events (norad_id, computed_at desc);

create index if not exists conjunction_events_recency_idx
  on conjunction_events (computed_at desc);

-- One row per alert actually sent, so runConjunctionScan() can avoid
-- re-paging a watcher about the same still-ongoing conjunction every 2h.
create table if not exists alerts_sent (
  id bigint generated always as identity primary key,
  watchlist_id bigint not null references watchlist (id) on delete cascade,
  other_norad_id integer not null,
  risk_level text not null,
  sent_at timestamptz not null default now()
);

create index if not exists alerts_sent_recent_idx
  on alerts_sent (watchlist_id, other_norad_id, sent_at desc);
