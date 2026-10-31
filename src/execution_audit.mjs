// Private execution state for the scanner/recovery process, not a new UI flow.
export const EXECUTION_AUDIT_SCHEMA=`CREATE TABLE IF NOT EXISTS execution_diagnostics (
  source text NOT NULL, market_ticker text NOT NULL, strategy text NOT NULL,
  game_id text NOT NULL, checked_at timestamptz NOT NULL, stage text NOT NULL,
  outcome text NOT NULL, detail text, context jsonb NOT NULL,
  PRIMARY KEY(source,market_ticker,strategy))`;

export function createExecutionAudit(query){
  let ready;
  return async function record({source,market,signal,game,stage,outcome='skipped',detail=null,startedAt=Date.now()}){
    ready??=query(EXECUTION_AUDIT_SCHEMA).catch(error=>{ready=null;throw error});
    await ready;
    const context={sport:game.sport,home:game.home,away:game.away,period:game.period,
      seconds:game.remainingSeconds,possession:game.possessionSide,scoreObservedAt:game.observedAt,
      ask:market.yes_ask_dollars,size:market.yes_ask_size_fp,fraction:signal.fraction};
    await query(`INSERT INTO execution_diagnostics
      (source,market_ticker,strategy,game_id,checked_at,stage,outcome,detail,context)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(source,market_ticker,strategy) DO UPDATE SET
        game_id=EXCLUDED.game_id,checked_at=EXCLUDED.checked_at,stage=EXCLUDED.stage,
        outcome=EXCLUDED.outcome,detail=EXCLUDED.detail,context=EXCLUDED.context
      WHERE execution_diagnostics.checked_at<=EXCLUDED.checked_at`,
    [source,market.ticker,signal.strategy,game.id,new Date(startedAt),stage,outcome,detail,JSON.stringify(context)]);
  };
}
