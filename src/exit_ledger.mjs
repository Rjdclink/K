export async function ensureExitLedger(query){
  await query(`CREATE TABLE IF NOT EXISTS exit_fill_ledger (
    order_id text PRIMARY KEY,market_ticker text NOT NULL,filled_count numeric(12,2) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await query(`INSERT INTO exit_fill_ledger(order_id,market_ticker,filled_count,updated_at)
    SELECT order_id,market_ticker,filled_count,clock_timestamp() FROM exit_attempts WHERE order_id IS NOT NULL AND filled_count>0
    ON CONFLICT(order_id) DO NOTHING`);
}
export async function recordExitFill(query,ticker,orderId,count){
  if(!(Number(count)>0))return;
  if(!orderId)throw Error('Filled exit is missing its Kalshi order ID');
  await query(`INSERT INTO exit_fill_ledger(order_id,market_ticker,filled_count) VALUES($1,$2,$3)
    ON CONFLICT(order_id) DO UPDATE SET filled_count=GREATEST(exit_fill_ledger.filled_count,EXCLUDED.filled_count),updated_at=now()`,[orderId,ticker,count]);
}
