CREATE TABLE IF NOT EXISTS game_snapshots (
  id text PRIMARY KEY,
  title text NOT NULL,
  sport text NOT NULL,
  sport_family text,
  home integer,
  away integer,
  status text NOT NULL,
  progress numeric,
  period text,
  time_left text,
  clock_seconds integer,
  clock_label text,
  clock_observed_at timestamptz,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS time_left text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS sport_family text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_seconds integer;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_label text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_observed_at timestamptz;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS score_observed_at timestamptz;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS possession_side text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS home_team_id text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS away_team_id text;
CREATE TABLE IF NOT EXISTS trade_attempts (
  id uuid PRIMARY KEY,
  market_ticker text NOT NULL,
  event_ticker text NOT NULL,
  game_id text NOT NULL,
  sport text NOT NULL,
  strategy text NOT NULL,
  reason text NOT NULL,
  fraction numeric NOT NULL,
  count numeric(12,2) NOT NULL,
  limit_price numeric NOT NULL,
  available_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved',
  order_id text,
  fill_count numeric NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_review text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_ticker, strategy)
);
ALTER TABLE trade_attempts ADD COLUMN IF NOT EXISTS available_cents integer NOT NULL DEFAULT 0;
ALTER TABLE trade_attempts ADD COLUMN IF NOT EXISTS attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trade_attempts ADD COLUMN IF NOT EXISTS combo_legs jsonb;
ALTER TABLE trade_attempts ADD COLUMN IF NOT EXISTS combo_rfq_id text;
ALTER TABLE trade_attempts ADD COLUMN IF NOT EXISTS combo_quote_id text;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trade_per_market_idx ON trade_attempts(market_ticker)
  WHERE status IN ('filled','reserved','check_order','retrying','combo_pending');
CREATE TABLE IF NOT EXISTS position_upgrades (
  market_ticker text PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  original_id uuid NOT NULL,
  verification_id uuid NOT NULL,
  status text NOT NULL,
  count numeric(12,2) NOT NULL,
  limit_price numeric NOT NULL,
  available_cents integer NOT NULL,
  order_id text,
  fill_count numeric NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fallback_verifications (
  market_ticker text PRIMARY KEY,
  original_id uuid NOT NULL,
  verification_id uuid NOT NULL,
  first_verified_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS combo_diagnostics (
  id bigserial PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  leg_tickers jsonb NOT NULL,
  collection_ticker text,
  status text NOT NULL,
  detail text
);
CREATE TABLE IF NOT EXISTS combo_upgrades (
  market_ticker text PRIMARY KEY,
  original_id uuid NOT NULL,
  verification_ids jsonb NOT NULL,
  status text NOT NULL,
  rfq_id text NOT NULL,
  quote_id text NOT NULL,
  order_id text,
  fill_count numeric NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_attempts ALTER COLUMN count TYPE numeric(12,2) USING count::numeric;
CREATE TABLE IF NOT EXISTS scan_status (
  id integer PRIMARY KEY CHECK (id = 1),
  last_scan timestamptz,
  last_error text,
  scanned integer NOT NULL DEFAULT 0,
  discovered integer NOT NULL DEFAULT 0,
  signals integer NOT NULL DEFAULT 0,
  orders_submitted integer NOT NULL DEFAULT 0
);
ALTER TABLE scan_status ADD COLUMN IF NOT EXISTS clock_refresh_at timestamptz;
ALTER TABLE scan_status ADD COLUMN IF NOT EXISTS discovered integer NOT NULL DEFAULT 0;
INSERT INTO scan_status(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS weather_scan_status (
  id integer PRIMARY KEY CHECK (id=1),
  last_scan timestamptz,
  series integer NOT NULL DEFAULT 0,
  events integer NOT NULL DEFAULT 0,
  eligible integer NOT NULL DEFAULT 0,
  verified integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  orders_submitted integer NOT NULL DEFAULT 0
);
INSERT INTO weather_scan_status(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS funding_transfers (
  id uuid PRIMARY KEY,
  market_ticker text NOT NULL,
  strategy text NOT NULL,
  source_shard integer NOT NULL,
  destination_shard integer NOT NULL,
  amount_centicents bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  transfer_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funding_transfers_market_created_idx ON funding_transfers(market_ticker,strategy,created_at DESC);
CREATE TABLE IF NOT EXISTS account_cache (
  id integer PRIMARY KEY CHECK (id=1),
  balance_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT to_timestamp(0),
  last_request_at timestamptz NOT NULL DEFAULT to_timestamp(0)
);
ALTER TABLE account_cache ADD COLUMN IF NOT EXISTS last_request_at timestamptz NOT NULL DEFAULT to_timestamp(0);
INSERT INTO account_cache(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS exit_attempts (
  id uuid PRIMARY KEY,
  market_ticker text NOT NULL UNIQUE,
  game_id text NOT NULL,
  requested_count numeric(12,2) NOT NULL,
  filled_count numeric(12,2) NOT NULL DEFAULT 0,
  limit_price numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  order_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settlement_alerts (
  id bigserial PRIMARY KEY,
  ticker text NOT NULL,
  settled_time timestamptz NOT NULL,
  profit_cents integer NOT NULL CHECK (profit_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticker,settled_time)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_deliveries (
  alert_id bigint NOT NULL REFERENCES settlement_alerts(id),
  endpoint text NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(alert_id,endpoint)
);
CREATE TABLE IF NOT EXISTS settlement_poll (
  id integer PRIMARY KEY CHECK (id=1),
  last_check timestamptz NOT NULL DEFAULT to_timestamp(0)
);
INSERT INTO settlement_poll(id) VALUES(1) ON CONFLICT DO NOTHING;
-- The one-time marker is created before this feature deploys. Reapplying the
-- schema keeps the original start time and does not backfill older trades.
CREATE TABLE IF NOT EXISTS trade_history_config (
  id integer PRIMARY KEY CHECK (id=1),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO trade_history_config(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS trade_history (
  id uuid PRIMARY KEY,
  market_ticker text NOT NULL,
  sport text NOT NULL,
  teams text NOT NULL,
  occurred_at timestamptz NOT NULL,
  profit_cents integer NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_history_occurred_idx ON trade_history(occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS execution_diagnostics (
  source text NOT NULL, market_ticker text NOT NULL, strategy text NOT NULL,
  game_id text NOT NULL, checked_at timestamptz NOT NULL, stage text NOT NULL,
  outcome text NOT NULL, detail text, context jsonb NOT NULL,
  PRIMARY KEY(source,market_ticker,strategy)
);
CREATE TABLE IF NOT EXISTS combo_exclusions (
  exclusion_key text PRIMARY KEY,leg_tickers jsonb NOT NULL,status text NOT NULL,
  detail text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sports_discovery_cache (
  id integer PRIMARY KEY,milestones jsonb NOT NULL,discovered_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS player_prop_windows (
  market_ticker text PRIMARY KEY,
  game_id text NOT NULL,
  first_crossed timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_value integer NOT NULL
);

-- Timed verification belongs to the exact contract, independently of scan windows.
CREATE TABLE IF NOT EXISTS over_verification_windows (
  market_ticker text PRIMARY KEY,
  game_id text NOT NULL,
  contract_key text NOT NULL,
  generation uuid NOT NULL,
  initial_at bigint NOT NULL,
  last_seen bigint NOT NULL,
  first_external_at bigint,
  first_external_id uuid,
  contract jsonb NOT NULL,
  initial_state jsonb NOT NULL
);

ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE account_cache ADD COLUMN IF NOT EXISTS invalidated_at timestamptz;

-- Resume distinct unordered combo plans; never issue a second RFQ for a group.

CREATE TABLE IF NOT EXISTS combo_plan_cursors (
  scope_key text PRIMARY KEY,progress jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS combo_plan_jobs (
  group_key text PRIMARY KEY,queue_order bigserial NOT NULL,leg_tickers text[] NOT NULL,collection_ticker text NOT NULL,
  phase text NOT NULL DEFAULT 'planned',lease_id uuid,lease_until timestamptz,
  combo_ticker text,combo_event_ticker text,combo_market jsonb,rfq_id text,
  rfq_requested_at timestamptz,rfq_attempts integer NOT NULL DEFAULT 0 CHECK(rfq_attempts<=1),
  outcome text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE combo_plan_jobs ADD COLUMN IF NOT EXISTS queue_order bigserial;
CREATE INDEX IF NOT EXISTS combo_plan_jobs_queue_idx ON combo_plan_jobs(queue_order)
  WHERE phase IN ('planned','market_ready');

CREATE TABLE IF NOT EXISTS history_reconciliation_work (trade_id uuid PRIMARY KEY,last_attempt_at timestamptz NOT NULL);
