CREATE TABLE IF NOT EXISTS game_snapshots (
  id text PRIMARY KEY,
  title text NOT NULL,
  sport text NOT NULL,
  home integer,
  away integer,
  status text NOT NULL,
  progress numeric,
  period text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS trade_attempts (
  id uuid PRIMARY KEY,
  market_ticker text NOT NULL,
  event_ticker text NOT NULL,
  game_id text NOT NULL,
  sport text NOT NULL,
  strategy text NOT NULL,
  reason text NOT NULL,
  fraction numeric NOT NULL,
  count integer NOT NULL,
  limit_price numeric NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  order_id text,
  fill_count numeric NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_ticker, strategy)
);
CREATE TABLE IF NOT EXISTS scan_status (
  id integer PRIMARY KEY CHECK (id = 1),
  last_scan timestamptz,
  last_error text,
  scanned integer NOT NULL DEFAULT 0,
  signals integer NOT NULL DEFAULT 0,
  orders_submitted integer NOT NULL DEFAULT 0
);
INSERT INTO scan_status(id) VALUES(1) ON CONFLICT DO NOTHING;
