// Fee-calibrated, exchange-authoritative realized results for settled markets.
// Avoid making any partially imported batch visible as financial history.
export function verifiedPositionProfit(position){
 const profit=Number(position?.realized_pnl_dollars);
 const fees=Number(position?.fees_paid_dollars);
 if(position?.realized_pnl_dollars==null||position?.fees_paid_dollars==null||
   !Number.isFinite(profit)||!Number.isFinite(fees)||fees<0)return null;
 return Math.round((profit-fees)*100);
}
export async function ensureVerifiedPositionTables(query){
 await query('CREATE TABLE IF NOT EXISTS account_position_history_publish ('+
   'id integer PRIMARY KEY,published_at timestamptz)');
 await query('CREATE TABLE IF NOT EXISTS account_position_realized_history ('+
   'ticker text PRIMARY KEY,occurred_at timestamptz NOT NULL,profit_cents bigint NOT NULL,'+
   'source_completed_at timestamptz NOT NULL)');
}
export async function publishVerifiedPositions({query,minCalibration=25}){
 await ensureVerifiedPositionTables(query);
 const {rows:[state]}=await query(`SELECT s.completed_at,p.published_at FROM account_positions_sync s
   LEFT JOIN account_position_history_publish p ON p.id=1 WHERE s.id=1 AND s.phase='complete'`);
 if(!state?.completed_at)return {status:'deferred',reason:'Position import is incomplete'};
 const complete=new Date(state.completed_at);
 if(!Number.isFinite(complete.getTime()))throw Error('Invalid completed position import timestamp');
 if(state.published_at&&new Date(state.published_at).getTime()>=complete.getTime())
   return {status:'unchanged'};
 const {rows}=await query(`SELECT p.ticker,p.raw AS position,s.raw AS settlement,
   a.profit_cents AS known_cents
   FROM account_history_positions p
   JOIN account_history_settlements s ON s.ticker=p.ticker
   LEFT JOIN account_realized_history a ON a.ticker=p.ticker`);
 const seen=new Set(),entries=[];let comparisons=0;
 for(const row of rows){
  if(!row.ticker||seen.has(row.ticker))throw Error('Ambiguous duplicate settlement ticker; account profits not published');
  seen.add(row.ticker);
  const cents=verifiedPositionProfit(row.position);
  const time=new Date(row.settlement?.settled_time||'');
  if(cents===null||!Number.isFinite(time.getTime())||
    !['yes','no'].includes(row.settlement?.market_result))
    throw Error('Incomplete settled position or settlement; account profits not published');
  if(row.known_cents!==null&&row.known_cents!==undefined){
   const known=Number(row.known_cents);
   if(!Number.isFinite(known)||Math.abs(cents-known)>1)
     throw Error('Position fee calibration conflicts with fill-and-settlement accounting');
   comparisons++;
  }
  entries.push({ticker:row.ticker,occurredAt:time.toISOString(),profitCents:cents});
 }
 if(comparisons<minCalibration)
  return {status:'deferred',reason:'Insufficient independent fill calibration',comparisons};
 if(!entries.length)return {status:'deferred',reason:'No settled account positions'};
 for(let start=0;start<entries.length;start+=80){
  const part=entries.slice(start,start+80);
  const params=part.map((_,i)=>'($'+(i*4+1)+',$'+(i*4+2)+
    '::timestamptz,$'+(i*4+3)+'::bigint,$'+(i*4+4)+'::timestamptz)').join(',');
  await query('INSERT INTO account_position_realized_history(ticker,occurred_at,profit_cents,source_completed_at) VALUES '+
    params+' ON CONFLICT(ticker) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,'+
    'profit_cents=EXCLUDED.profit_cents,source_completed_at=EXCLUDED.source_completed_at',
    part.flatMap(p=>[p.ticker,p.occurredAt,p.profitCents,complete.toISOString()]));
 }
 // Atomic publication gate: anything written before the last complete batch
 // remains invisible to the History UI.
 await query('INSERT INTO account_position_history_publish(id,published_at) VALUES(1,$1::timestamptz)'+
   ' ON CONFLICT(id) DO UPDATE SET published_at=EXCLUDED.published_at',
   [complete.toISOString()]);
 return {status:'published',positions:entries.length,comparisons};
}
