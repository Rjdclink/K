// Durable, bounded entry rechecks: an immediate eligible check followed by
// at most two additional checks separated by ten real seconds.
export const ENTRY_RECHECK_INTERVAL_MS=10_000;
export const ENTRY_RECHECK_LIMIT=2;
export function createEntryRechecks(query){
 let ready;
 const ensure=()=>ready??=query([
  'CREATE TABLE IF NOT EXISTS entry_rechecks (',
  'market_ticker text PRIMARY KEY,game_id text NOT NULL,',
  "strategy text NOT NULL CHECK (strategy IN ('no','over')),",
  'first_at timestamptz NOT NULL DEFAULT clock_timestamp(),',
  'next_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0',
  'CHECK (attempts BETWEEN 0 AND 2),claimed_at timestamptz,',
  'finished_at timestamptz,last_reason text)'
 ].join(' ')).catch(error=>{ready=null;throw error});
 const register=async(ticker,gameId,strategy)=>{
  if(!ticker||!gameId||!['no','over'].includes(strategy))return false;
  await ensure();
  const result=await query([
   'INSERT INTO entry_rechecks(market_ticker,game_id,strategy,next_at)',
   "SELECT $1,$2,$3,clock_timestamp()+interval '10 seconds'",
   'WHERE NOT EXISTS (SELECT 1 FROM trade_attempts t',
   'WHERE t.market_ticker=$1 AND t.status IN',
   "('filled','reserved','retrying','check_order','combo_pending'))",
   'ON CONFLICT (market_ticker) DO NOTHING'
  ].join(' '),[ticker,gameId,strategy]);
  return result.rowCount===1;
 };
 const claimDue=async(limit=10)=>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>24)return [];
  await ensure();
  const result=await query([
   'WITH due AS (SELECT r.market_ticker FROM entry_rechecks r',
   'WHERE r.finished_at IS NULL AND r.attempts < 2',
   'AND r.next_at<=clock_timestamp()',
   "AND (r.claimed_at IS NULL OR r.claimed_at<clock_timestamp()-interval '30 seconds')",
   'AND NOT EXISTS (SELECT 1 FROM trade_attempts t',
   'WHERE t.market_ticker=r.market_ticker AND t.status IN',
   "('filled','reserved','retrying','check_order','combo_pending'))",
   'ORDER BY r.next_at LIMIT $1 FOR UPDATE SKIP LOCKED)',
   'UPDATE entry_rechecks r SET attempts=r.attempts+1,claimed_at=clock_timestamp()',
   'FROM due WHERE r.market_ticker=due.market_ticker',
   'RETURNING r.market_ticker,r.game_id,r.strategy,r.attempts'
  ].join(' '),[limit]);
  return result.rows;
 };
 const finish=async(ticker,gameId,reason)=>{
  if(!ticker||!gameId)return;
  await ensure();
  await query([
   'UPDATE entry_rechecks r SET claimed_at=NULL,last_reason=LEFT($3,200),',
   'finished_at=CASE WHEN r.attempts>=2 OR EXISTS',
   '(SELECT 1 FROM trade_attempts t WHERE t.market_ticker=r.market_ticker',
   "AND t.status IN ('filled','reserved','retrying','check_order','combo_pending'))",
   'THEN clock_timestamp() ELSE NULL END,',
   "next_at=CASE WHEN r.attempts>=2 THEN r.next_at ELSE r.first_at+((r.attempts+1)*interval '10 seconds') END",
   'WHERE r.market_ticker=$1 AND r.game_id=$2'
  ].join(' '),[ticker,gameId,String(reason||'checked')]);
 };
 const registerMany=async(items,strategy)=>{
  if(!['over','no'].includes(strategy)||!Array.isArray(items))return [];
  const seen=new Set(),rows=[];
  for(const item of items){
   const market_ticker=String(item?.market_ticker||''),game_id=String(item?.game_id||'');
   if(!market_ticker||!game_id||seen.has(market_ticker))continue;
   seen.add(market_ticker);rows.push({market_ticker,game_id});
  }
  if(!rows.length)return [];
  await ensure();
  const result=await query([
   'INSERT INTO entry_rechecks(market_ticker,game_id,strategy,next_at)',
   "SELECT x.market_ticker,x.game_id,$2,clock_timestamp()+interval '10 seconds'",
   'FROM jsonb_to_recordset($1::jsonb) x(market_ticker text,game_id text)',
   'WHERE NOT EXISTS (SELECT 1 FROM trade_attempts t',
   'WHERE t.market_ticker=x.market_ticker AND t.status IN',
   "('filled','reserved','retrying','check_order','combo_pending'))",
   'ON CONFLICT (market_ticker) DO NOTHING',
   'RETURNING market_ticker,game_id,strategy'
  ].join(' '),[JSON.stringify(rows),strategy]);
  return result.rows;
 };
 return {ensure,register,registerMany,claimDue,finish};
}

// A single game-level final pass can verify all its strike lines with one
// fresh ESPN fixture read while retaining individual first proofs and orders.
export function groupEntryRechecks(rows){
 const groups=new Map();
 for(const item of rows||[]){
  if(!item?.game_id||!['no','over'].includes(item.strategy)||!item.market_ticker)continue;
  const key=item.strategy+'\0'+item.game_id;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(item);
 }
 return [...groups.values()];
}