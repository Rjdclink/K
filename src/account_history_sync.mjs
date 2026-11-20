import {summarizeAccountMarkets} from './account_history.mjs';

// Read-only exchange imports. Account history is published only after both
// live + archived fills and account settlements reach the final cursor.
// Upserts are idempotent: a retry never double-counts a partial fill.
export async function ensureAccountHistoryTables(query){
 await query(`CREATE TABLE IF NOT EXISTS account_history_fills (
   fill_id text PRIMARY KEY,ticker text NOT NULL,filled_at timestamptz NOT NULL,
   raw jsonb NOT NULL)`);
 await query(`CREATE TABLE IF NOT EXISTS account_history_settlements (
   settlement_id text PRIMARY KEY,ticker text NOT NULL,settled_at timestamptz NOT NULL,
   raw jsonb NOT NULL)`);
 await query(`CREATE TABLE IF NOT EXISTS account_realized_history (
   ticker text PRIMARY KEY,occurred_at timestamptz NOT NULL,
   profit_cents bigint NOT NULL,outcome text NOT NULL,
   fill_count integer NOT NULL,first_fill_at timestamptz NOT NULL,
   updated_at timestamptz NOT NULL DEFAULT now())`);
 await query(`CREATE TABLE IF NOT EXISTS account_history_sync (
   id integer PRIMARY KEY,phase text NOT NULL DEFAULT 'live_fills',
   cursor text NOT NULL DEFAULT '',last_completed timestamptz,
   last_error text,unresolved_markets integer NOT NULL DEFAULT 0,
   updated_at timestamptz NOT NULL DEFAULT now())`);
 await query('ALTER TABLE account_history_sync ADD COLUMN IF NOT EXISTS unresolved_markets integer NOT NULL DEFAULT 0');
 await query("INSERT INTO account_history_sync(id,phase,cursor) VALUES(1,'live_fills','') ON CONFLICT DO NOTHING");
}
const validDate=value=>{if(value===null||value===undefined||value==='')return null;
 const dt=new Date(value);return Number.isFinite(dt.getTime())?dt.toISOString():null;};
const parseFill=fill=>{
 const fillId=String(fill.fill_id||fill.trade_id||'');
 const ticker=String(fill.ticker||fill.market_ticker||'');
 const date=validDate(fill.created_time||(
   Number.isFinite(Number(fill.ts))?Number(fill.ts)*1000:null));
 if(!fillId||!ticker||!date)throw Error('Account history fill missing stable ID, ticker, or timestamp; import deferred');
 return {id:fillId,ticker,date,raw:fill};
};
const parseSettlement=settlement=>{
 const ticker=String(settlement.ticker||''),date=validDate(settlement.settled_time);
 if(!ticker||!date)throw Error('Account history settlement missing ticker or settled time; import deferred');
 const subaccount=settlement.subaccount_number??settlement.subaccount??'all';
 return {id:ticker+'|'+date+'|'+subaccount,ticker,date,raw:settlement};
};
async function persistPage(query,table,items,parse){
 const values=items.map(parse);
 for(let start=0;start<values.length;start+=100){
  const group=values.slice(start,start+100);
  const placeholders=group.map((_,i)=>'($'+(i*4+1)+',$'+(i*4+2)+',$'+
    (i*4+3)+'::timestamptz,$'+(i*4+4)+'::jsonb)').join(',');
  const keys=table==='account_history_fills'?
   ['fill_id','ticker','filled_at','raw']:['settlement_id','ticker','settled_at','raw'];
  await query('INSERT INTO '+table+'('+keys.join(',')+') VALUES '+placeholders+
    ' ON CONFLICT('+keys[0]+') DO UPDATE SET '+keys[1]+'=EXCLUDED.'+keys[1]+
    ','+keys[2]+'=EXCLUDED.'+keys[2]+',raw=EXCLUDED.raw',
    group.flatMap(x=>[x.id,x.ticker,x.date,JSON.stringify(x.raw)]));
 }
 return values.length;
}
async function publish(query){
 const [{rows:fills},{rows:settlements}]=await Promise.all([
  query('SELECT raw FROM account_history_fills ORDER BY filled_at,fill_id'),
  query('SELECT raw FROM account_history_settlements ORDER BY settled_at,settlement_id')
 ]);
 const normalizedSettlements=new Map();
 for(const item of settlements){
  const s=item.raw;
  if(!s?.ticker)continue;
  const prior=normalizedSettlements.get(s.ticker);
  if(!prior){normalizedSettlements.set(s.ticker,{...s});continue;}
  // Separate subaccounts are combined only when their result and settlement
  // timestamp agree. Otherwise fail closed on this ambiguous market.
  if(prior.market_result!==s.market_result||prior.settled_time!==s.settled_time||
     !Number.isFinite(Number(prior.revenue))||!Number.isFinite(Number(s.revenue))){
   normalizedSettlements.set(s.ticker,{...s,revenue:NaN});continue;
  }
  normalizedSettlements.set(s.ticker,{...prior,revenue:Number(prior.revenue)+Number(s.revenue)});
 }
 const {rows,unresolved}=summarizeAccountMarkets(fills,[...normalizedSettlements.values()]);
 for(let start=0;start<rows.length;start+=80){
  const batch=rows.slice(start,start+80);
  const placeholders=batch.map((_,i)=>'($'+(i*6+1)+',$'+(i*6+2)+
    '::timestamptz,$'+(i*6+3)+'::bigint,$'+(i*6+4)+',$'+
    (i*6+5)+',$'+(i*6+6)+'::timestamptz)').join(',');
  await query('INSERT INTO account_realized_history(ticker,occurred_at,profit_cents,outcome,fill_count,first_fill_at) VALUES '+
   placeholders+' ON CONFLICT(ticker) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,'+
   'profit_cents=EXCLUDED.profit_cents,outcome=EXCLUDED.outcome,'+
   'fill_count=EXCLUDED.fill_count,first_fill_at=EXCLUDED.first_fill_at,updated_at=now()',
   batch.flatMap(r=>[r.ticker,r.occurredAt,r.profitCents,r.outcome,r.fillCount,r.firstFillAt]));
 }
 return {realized:rows.length,unresolved:unresolved.length,totalFills:fills.length,
   totalSettlements:settlements.length};
}
const sources={
 live_fills:{path:'/portfolio/fills',table:'account_history_fills',field:'fills',parse:parseFill,next:'archive_fills'},
 archive_fills:{path:'/historical/fills',table:'account_history_fills',field:'fills',parse:parseFill,next:'settlements'},
 settlements:{path:'/portfolio/settlements',table:'account_history_settlements',field:'settlements',parse:parseSettlement,next:'reconcile'}
};
export async function syncAccountHistory({query,fetchPage,now=Date.now(),maxPages=2}){
 await ensureAccountHistoryTables(query);
 const {rows:[initial]}=await query('SELECT phase,cursor,last_completed FROM account_history_sync WHERE id=1');
 let phase=initial.phase,cursor=initial.cursor||'';
 if(phase==='complete'){
  const last=Number(new Date(initial.last_completed));
  if(Number.isFinite(last)&&now-last<5*60000)
    return {phase:'complete',skipped:true};
  phase='live_fills';cursor='';
  await query("UPDATE account_history_sync SET phase='live_fills',cursor='',updated_at=now() WHERE id=1");
 }
 let imported=0;
 for(let page=0;page<Math.max(1,Math.floor(maxPages));page++){
  if(phase==='reconcile'){
   const result=await publish(query);
   await query("UPDATE account_history_sync SET phase='complete',cursor='',last_completed=now(),last_error=NULL,unresolved_markets=$1,updated_at=now() WHERE id=1",[result.unresolved]);
   return {phase:'complete',imported,...result};
  }
  const source=sources[phase];
  if(!source)throw Error('Unknown account history import phase: '+phase);
  const request=source.path+'?'+new URLSearchParams({limit:'500',...(cursor?{cursor}:{})});
  const response=await fetchPage(request);
  if(!response||!Array.isArray(response[source.field])||typeof response.cursor!=='string')
   throw Error('Account history '+phase+' returned incomplete pagination response');
  imported+=await persistPage(query,source.table,response[source.field],source.parse);
  const nextCursor=response.cursor||'';
  phase=nextCursor?phase:source.next;cursor=nextCursor;
  await query('UPDATE account_history_sync SET phase=$1,cursor=$2,last_error=NULL,updated_at=now() WHERE id=1',
   [phase,cursor]);
 }
 return {phase,imported};
}
