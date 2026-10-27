CREATE TABLE IF NOT EXISTS game_snapshots (
  id text PRIMARY KEY,
  title text NOT NULL,
  sport text NOT NULL,
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
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_seconds integer;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_label text;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS clock_observed_at timestamptz;
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
ALTER TABLE trade_attempts ALTER COLUMN count TYPE numeric(12,2) USING count::numeric;
CREATE TABLE IF NOT EXISTS scan_status (
  id integer PRIMARY KEY CHECK (id = 1),
  last_scan timestamptz,
  last_error text,
  scanned integer NOT NULL DEFAULT 0,
  signals integer NOT NULL DEFAULT 0,
  orders_submitted integer NOT NULL DEFAULT 0
);
INSERT INTO scan_status(id) VALUES(1) ON CONFLICT DO NOTHING;
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
