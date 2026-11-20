// Read-only Kalshi market-position reconciliation. No realized P&L is
// published until separately calibrated against executed fills and settlements.
export async function ensurePositionHistory(query){
 await query("CREATE TABLE IF NOT EXISTS account_history_positions ("+
   "ticker text PRIMARY KEY,source text NOT NULL,raw jsonb NOT NULL,"+
   "updated_at timestamptz NOT NULL DEFAULT now())");
 await query("CREATE TABLE IF NOT EXISTS account_positions_sync ("+
   "id integer PRIMARY KEY,phase text NOT NULL DEFAULT 'settled',"+
   "cursor text NOT NULL DEFAULT '',completed_at timestamptz,last_error text,"+
   "updated_at timestamptz NOT NULL DEFAULT now())");
 await query("INSERT INTO account_positions_sync(id,phase,cursor) VALUES(1,'settled','') ON CONFLICT DO NOTHING");
}
const feeds={
 settled:{path:'/portfolio/positions',next:'historical'},
 historical:{path:'/historical/positions',next:'complete'}
};
export async function syncAccountPositions({query,fetchPage,now=Date.now(),maxPages=2}){
 await ensurePositionHistory(query);
 const {rows:[state]}=await query('SELECT phase,cursor,completed_at FROM account_positions_sync WHERE id=1');
 if(!state)throw Error('Position sync missing state');
 let phase=state.phase,cursor=state.cursor||'';
 if(phase==='complete'){
  const completed=Date.parse(state.completed_at||'');
  if(Number.isFinite(completed)&&now-completed<6*3600000)return {phase,skipped:true};
  phase='settled';cursor='';
  await query("UPDATE account_positions_sync SET phase='settled',cursor='',updated_at=now() WHERE id=1");
 }
 let imported=0;
 for(let i=0;i<maxPages;i++){
  if(phase==='complete'){
   await query("UPDATE account_positions_sync SET phase='complete',cursor='',completed_at=now(),last_error=NULL,updated_at=now() WHERE id=1");
   return {phase,imported};
  }
  const feed=feeds[phase];if(!feed)throw Error('Unknown account position phase '+phase);
  const params=new URLSearchParams({limit:'500',
   ...(phase==='settled'?{settlement_status:'settled'}:{}),
   ...(cursor?{cursor}:{})});
  const response=await fetchPage(feed.path+'?'+params);
  if(!response||!Array.isArray(response.market_positions)||typeof response.cursor!=='string')
    throw Error('Incomplete Kalshi position pagination response for '+phase);
  for(const item of response.market_positions){
   if(!item||!item.ticker||!Number.isFinite(Number(item.realized_pnl_dollars))||
     item.realized_pnl_dollars==null||!Number.isFinite(Number(item.fees_paid_dollars))||
     item.fees_paid_dollars==null)
     throw Error('Incomplete Kalshi market position; financial result was not imported');
   await query("INSERT INTO account_history_positions(ticker,source,raw) VALUES($1,$2,$3::jsonb)"+
     " ON CONFLICT(ticker) DO UPDATE SET source=EXCLUDED.source,raw=EXCLUDED.raw,updated_at=now()",
     [item.ticker,phase,JSON.stringify(item)]);
   imported++;
  }
  cursor=response.cursor||'';
  if(!cursor)phase=feed.next;
  await query('UPDATE account_positions_sync SET phase=$1,cursor=$2,last_error=NULL,updated_at=now() WHERE id=1',
   [phase,cursor]);
 }
 return {phase,imported};
}
