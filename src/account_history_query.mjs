// One canonical realized trade per Kalshi market. Once an account-wide
// exchange-derived result exists, the old bot-only row is hidden, not added:
// combining both would double-count the same fills and settlements.
// Publish-calibrated settled-position results override fill-only and bot-only
// rows; unverified/in-progress batches remain invisible.
export const ACCOUNT_HISTORY_UNION_SQL=`
 WITH verified AS (
   SELECT p.ticker,p.occurred_at,p.profit_cents
   FROM account_position_realized_history p
   JOIN account_position_history_publish v
     ON v.id=1 AND v.published_at=p.source_completed_at
 )
 SELECT h.id,h.market_ticker,h.sport,h.teams,h.occurred_at,h.profit_cents::bigint AS profit_cents
 FROM trade_history h
 WHERE NOT EXISTS(SELECT 1 FROM account_realized_history a WHERE a.ticker=h.market_ticker)
   AND NOT EXISTS(SELECT 1 FROM verified p WHERE p.ticker=h.market_ticker)
 UNION ALL
 SELECT md5('kalshi-account-history:'||a.ticker)::uuid AS id,
   a.ticker AS market_ticker,
   COALESCE((SELECT h.sport FROM trade_history h WHERE h.market_ticker=a.ticker
     ORDER BY h.occurred_at DESC LIMIT 1),'Kalshi') AS sport,
   COALESCE((SELECT h.teams FROM trade_history h WHERE h.market_ticker=a.ticker
     ORDER BY h.occurred_at DESC LIMIT 1),
     (SELECT g.title FROM trade_attempts t JOIN game_snapshots g ON g.id=t.game_id
       WHERE t.market_ticker=a.ticker ORDER BY t.created_at DESC LIMIT 1),
     a.ticker) AS teams,
   a.occurred_at,a.profit_cents
 FROM account_realized_history a
 WHERE NOT EXISTS(SELECT 1 FROM verified p WHERE p.ticker=a.ticker)
 UNION ALL
 SELECT md5('kalshi-account-history:'||p.ticker)::uuid AS id,
   p.ticker AS market_ticker,
   COALESCE((SELECT h.sport FROM trade_history h WHERE h.market_ticker=p.ticker
     ORDER BY h.occurred_at DESC LIMIT 1),'Kalshi') AS sport,
   COALESCE((SELECT h.teams FROM trade_history h WHERE h.market_ticker=p.ticker
     ORDER BY h.occurred_at DESC LIMIT 1),
     (SELECT g.title FROM trade_attempts t JOIN game_snapshots g ON g.id=t.game_id
       WHERE t.market_ticker=p.ticker ORDER BY t.created_at DESC LIMIT 1),
     p.ticker) AS teams,
   p.occurred_at,p.profit_cents
 FROM verified p`;
export const accountHistoryListSQL=cutoff=>`WITH cutoff AS (${cutoff}),
 combined AS (${ACCOUNT_HISTORY_UNION_SQL})
 SELECT id,sport,teams,occurred_at,profit_cents FROM combined
 WHERE ($1::timestamptz IS NULL OR (occurred_at,id)<($1::timestamptz,$2::uuid))
 AND ($3::text='all' OR $3::text='profit' AND profit_cents>0 OR $3::text='loss' AND profit_cents<0)
 AND ($4::text='full' OR occurred_at>=(SELECT starts_at FROM cutoff))
 ORDER BY occurred_at DESC,id DESC LIMIT 51`;
export const accountHistorySummarySQL=cutoff=>`WITH cutoff AS (${cutoff}),
 combined AS (${ACCOUNT_HISTORY_UNION_SQL})
 SELECT count(*) FILTER (WHERE profit_cents>0) AS profit_count,
 count(*) FILTER (WHERE profit_cents<0) AS loss_count,
 COALESCE(sum(profit_cents) FILTER (WHERE profit_cents>0),0) AS profit_cents,
 COALESCE(sum(profit_cents) FILTER (WHERE profit_cents<0),0) AS loss_cents
 FROM combined WHERE ($1::text='full' OR occurred_at>=(SELECT starts_at FROM cutoff))`;
