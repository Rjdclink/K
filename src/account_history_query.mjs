// One canonical realized trade per Kalshi market. Once an account-wide
// exchange-derived result exists, the old bot-only row is hidden, not added:
// combining both would double-count the same fills and settlements.
// Publish-calibrated settled-position results override fill-only and bot-only
// rows; unverified/in-progress batches remain invisible.
// History uses completed exchange settlement and matched collateral evidence
// before legacy bot-only estimates. Settlement.revenue is CENTS and does NOT
// include collateral returned when bought YES and NO shares offset.
export const ACCOUNT_HISTORY_UNION_SQL=`
 WITH verified AS (
   SELECT p.ticker,p.occurred_at,p.profit_cents
   FROM account_position_realized_history p
   JOIN account_position_history_publish v
     ON v.id=1 AND v.published_at=p.source_completed_at
 ),
 settlement_values AS (
   SELECT s.ticker,s.settled_at,s.raw->>'market_result' result,
    CASE WHEN s.raw->>'no_count_fp' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'no_count_fp')::numeric END AS no_qty,
    CASE WHEN s.raw->>'yes_count_fp' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'yes_count_fp')::numeric END AS yes_qty,
    CASE WHEN s.raw->>'no_total_cost_dollars' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'no_total_cost_dollars')::numeric END AS no_cost,
    CASE WHEN s.raw->>'yes_total_cost_dollars' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'yes_total_cost_dollars')::numeric END AS yes_cost,
    CASE WHEN s.raw->>'fee_cost' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'fee_cost')::numeric END AS fees,
    CASE WHEN s.raw->>'revenue' ~ '^[0-9]+([.][0-9]+)?$' THEN (s.raw->>'revenue')::numeric END AS revenue_cents
   FROM account_history_settlements s
 ),
 exchange_settled AS (
   SELECT ticker,MAX(settled_at) occurred_at,
     ROUND(SUM(LEAST(no_qty,yes_qty)+revenue_cents/100-no_cost-yes_cost-fees)*100)::bigint profit_cents
   FROM settlement_values
   GROUP BY ticker
   HAVING COUNT(*) FILTER(WHERE result NOT IN ('yes','no') OR result IS NULL OR
     no_qty IS NULL OR yes_qty IS NULL OR no_cost IS NULL OR yes_cost IS NULL OR
     fees IS NULL OR revenue_cents IS NULL OR no_qty<0 OR yes_qty<0 OR
     no_cost<0 OR yes_cost<0 OR fees<0 OR revenue_cents<0 OR
     revenue_cents>(CASE WHEN result='yes' THEN yes_qty ELSE no_qty END-
       LEAST(no_qty,yes_qty))*100+0.011)=0
     AND COUNT(DISTINCT result)=1 AND COUNT(DISTINCT settled_at)=1
 ),
 offset_fills AS (
   SELECT f.ticker,f.filled_at,f.raw->>'side' side,f.raw->>'action' action,
     f.raw->>'order_id' order_id,
     CASE WHEN f.raw->>'count_fp' ~ '^[0-9]+([.][0-9]+)?$' THEN (f.raw->>'count_fp')::numeric END qty,
     CASE WHEN f.raw->>'fee_cost' ~ '^[0-9]+([.][0-9]+)?$' THEN (f.raw->>'fee_cost')::numeric END fee,
     CASE WHEN f.raw->>'side'='no' AND f.raw->>'no_price_dollars' ~ '^[0-9]+([.][0-9]+)?$'
       THEN (f.raw->>'no_price_dollars')::numeric
       WHEN f.raw->>'side'='yes' AND f.raw->>'yes_price_dollars' ~ '^[0-9]+([.][0-9]+)?$'
       THEN (f.raw->>'yes_price_dollars')::numeric END price
   FROM account_history_fills f
 ),
 closed_offsets AS (
   SELECT f.ticker,MAX(f.filled_at) occurred_at,
     ROUND((LEAST(SUM(CASE WHEN f.side='no' THEN f.qty ELSE 0 END),
                  SUM(CASE WHEN f.side='yes' THEN f.qty ELSE 0 END))-
       SUM(f.qty*f.price)-SUM(f.fee))*100)::bigint profit_cents
   FROM offset_fills f
   JOIN account_history_sync sync ON sync.id=1
   GROUP BY f.ticker,sync.last_completed
   HAVING COUNT(*) FILTER(WHERE f.side NOT IN ('yes','no') OR f.side IS NULL OR
     f.action NOT IN ('buy','sell') OR f.action IS NULL OR
     f.order_id IS NULL OR f.order_id='' OR
     f.qty IS NULL OR f.qty<=0 OR f.price IS NULL OR f.price<0 OR f.price>1 OR
     f.fee IS NULL OR f.fee<0)=0
     AND SUM(CASE WHEN f.side='no' THEN f.qty ELSE 0 END)>0
     AND SUM(CASE WHEN f.side='yes' THEN f.qty ELSE 0 END)>0
     AND ABS(SUM(CASE WHEN f.side='no' THEN f.qty ELSE 0 END)-
       SUM(CASE WHEN f.side='yes' THEN f.qty ELSE 0 END))<=0.011
     AND MAX(f.filled_at)<=sync.last_completed
 ),
 candidates AS (
   SELECT ticker,occurred_at,profit_cents,1 priority FROM verified
   UNION ALL SELECT ticker,occurred_at,profit_cents,2 priority FROM exchange_settled
   UNION ALL SELECT ticker,occurred_at,profit_cents,3 priority FROM closed_offsets
   UNION ALL SELECT ticker,occurred_at,profit_cents,4 priority FROM account_realized_history
 ),
 authoritative AS (
   SELECT DISTINCT ON (ticker) ticker,occurred_at,profit_cents
   FROM candidates ORDER BY ticker,priority
 )
 SELECT h.id,h.market_ticker,h.sport,h.teams,h.occurred_at,h.profit_cents::bigint AS profit_cents
 FROM trade_history h
 WHERE NOT EXISTS(SELECT 1 FROM authoritative a WHERE a.ticker=h.market_ticker)
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
 FROM authoritative a`;
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
