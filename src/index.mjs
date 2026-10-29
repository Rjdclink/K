import { golfSignal, verifyGolf } from './golf.mjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { page } from './ui.mjs';
import { historyPage } from './history_ui.mjs';
import { completedTrade } from './history.mjs';
import { gameState, overSignal, confirmedOver, leadSignal, additionalLeadSignal, tennisSignal, tableTennisSignal, orderSize, estimatedCostCents, overBudget, profitableCount, netSettlementProfitCents, comeback } from './strategy.mjs';
import { reviewMiss } from './ai.mjs';
import { kalshiSignature } from './auth.mjs';
import { marketShard, shardCash, transferPlan } from './funding.mjs';
import { icons } from './icons.mjs';
import { manifest, worker } from './pwa.mjs';
import { vapidIdentity, validateSubscription, deliverPush } from './push.mjs';
import { favorableSettlement } from './settlements.mjs';
import { authorized, checkCredentials, sessionCookie, loginPage } from './dashboard_auth.mjs';
import { eligibleForMarkets, linkedEventTickers, gameTimeLabel, storedClockSeconds } from './discovery.mjs';
import { tieRefundPreference } from './settlement_preference.mjs';
import { verifyIndependentOver, verifyIndependentTableTennisLead } from './score_verification.mjs';
import { COMBO_WINDOW_MS, compatibleComboGroups, comboLegs, filledComboWindow, quoteForYes } from './combos.mjs';
import { estimatedSaleProfitCents } from './positions.mjs';
import { weatherContract } from './weather.mjs';
import { scanWeatherMarkets } from './weather_scanner.mjs';
import { sellQuote } from './sell.mjs';
import { yesDepthAtAsk, bestYesAsk } from './orderbook.mjs';

const API='https://external-api.kalshi.com/trade-api/v2';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:4, idleTimeoutMillis:15000});
pool.on('error', e=>console.error('Idle database connection:',e.message));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const configured=()=>Boolean((process.env.KALSHI_API_KEY||process.env.KALSHI_API_KEY_ID) && process.env.KALSHI_PRIVATE_KEY);
const live=()=>configured() && process.env.LIVE_TRADING==='true';
const exitOnly=()=>configured() && process.env.EXIT_ONLY==='true' && !live();
const credentials=()=>({key:process.env.KALSHI_API_KEY||process.env.KALSHI_API_KEY_ID,privateKey:process.env.KALSHI_PRIVATE_KEY});
const pushIdentity=()=>vapidIdentity(process.env.KALSHI_PRIVATE_KEY);
const response=(body,type)=>new Response(body,{headers:{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'}});
const dashboardAuth=req=>authorized(req,process.env.DASHBOARD_PASSWORD);
const kalshiRateLimit=async(method)=>{
  const kind=method==='GET'?'read':'write';
  const spacing=method==='GET'?70:130;
  const client=await pool.connect();
  let wait=0;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(83027545)');
    await client.query('CREATE TABLE IF NOT EXISTS kalshi_rate_limits (kind text PRIMARY KEY, next_at timestamptz NOT NULL)');
    const {rows:[slot]}=await client.query(`INSERT INTO kalshi_rate_limits(kind,next_at) VALUES($1,clock_timestamp()+($2 * interval '1 millisecond')) ON CONFLICT(kind) DO UPDATE SET next_at=GREATEST(kalshi_rate_limits.next_at,clock_timestamp())+($2 * interval '1 millisecond') RETURNING EXTRACT(EPOCH FROM (next_at-clock_timestamp()))*1000 AS wait_ms`,[kind,spacing]);
    wait=Math.max(0,Number(slot.wait_ms)-spacing);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
  if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
};
async function kalshi(path,opts={}){
  const method=opts.method||'GET';const headers={'accept':'application/json'};
  if(opts.auth){const {key,privateKey}=credentials();if(!key||!privateKey)throw Error('Kalshi credentials unavailable');const timestamp=String(Date.now());const unsignedPath='/trade-api/v2'+path.split('?')[0];const signature=kalshiSignature(privateKey,timestamp,method,unsignedPath);Object.assign(headers,{'KALSHI-ACCESS-KEY':key,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature})}
  if(opts.body)headers['content-type']='application/json';
  for(let attempt=0;;attempt++){
    await kalshiRateLimit(method);
    const response=await fetch(API+path,{method,headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(12000)});
    const data=await response.json().catch(()=>({}));
    if(response.status===429 && method==='GET' && attempt<4){await new Promise(resolve=>setTimeout(resolve,500*2**attempt));continue}
    if(!response.ok){const detail=data.message||data.error?.message||data.error?.code||data.error||data.code||'request failed';throw Error(`Kalshi ${response.status} ${method} ${path.split('?')[0]}: ${String(typeof detail==='object'?JSON.stringify(detail):detail).slice(0,140)}`)}
    return data;
  }
}
// The balance endpoint's Basic tier bucket is shared by every function instance.
// Serialize refreshes through Postgres and reuse a recent verified account snapshot.
let balanceQueue=Promise.resolve();
let candidateTableReady;
function candidateTable(){return candidateTableReady??=pool.query(`CREATE TABLE IF NOT EXISTS candidate_windows (market_ticker text NOT NULL, strategy text NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(market_ticker,strategy))`).catch(e=>{candidateTableReady=null;throw e})}
function accountBalance({fresh=false}={}){
  const job=balanceQueue.catch(()=>{}).then(async()=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(83027544)');
      const {rows:[cached]}=await client.query('SELECT balance_json,updated_at,last_request_at FROM account_cache WHERE id=1 FOR UPDATE');
      const elapsed=Date.now()-new Date(cached?.updated_at||0).getTime();
      if(!fresh&&cached?.balance_json&&elapsed<2000){await client.query('COMMIT');return cached.balance_json}
      const sinceRequest=Date.now()-new Date(cached?.last_request_at||0).getTime();
      const delay=1250-sinceRequest;if(delay>0&&delay<1250)await new Promise(resolve=>setTimeout(resolve,delay));
      await client.query('UPDATE account_cache SET last_request_at=clock_timestamp() WHERE id=1');
      const value=await kalshi('/portfolio/balance',{auth:true});
      await client.query('UPDATE account_cache SET balance_json=$1,updated_at=clock_timestamp() WHERE id=1',[JSON.stringify(value)]);
      await client.query('COMMIT');
      return value;
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
    finally{client.release()}
  });
  balanceQueue=job.catch(()=>{});return job;
}
async function invalidateBalance(){await pool.query('UPDATE account_cache SET updated_at=to_timestamp(0) WHERE id=1')}
let auditReady;
async function auditTable(){return auditReady??=pool.query(`CREATE TABLE IF NOT EXISTS verification_records(id uuid PRIMARY KEY,market_ticker text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),passed boolean NOT NULL,evidence jsonb NOT NULL)`).catch(e=>{auditReady=null;throw e})}
async function auditedOver(game,milestone,options={}){
  const observations=[];
  const fetcher=async(url,opts)=>{
    const at=new Date().toISOString(),key='raw:'+url,cached=options.cache?.get(key);
    const task=cached&&Date.now()-cached.at<2000?cached.value:(async()=>{
      const r=await fetch(url,opts),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
      return {ok:r.ok,status:r.status,data,raw,requested_at:at,received_at:new Date().toISOString()};
    })();
    if(!cached||Date.now()-cached.at>=2000)options.cache?.set(key,{at:Date.now(),value:task});
    try{const r=await task;observations.push({source:url.includes('espn.com')?'ESPN':url.includes('cdn.nba.com')?'NBA':url.includes('cbssports.com')?'CBS':url.includes('yahoo.com')?'Yahoo':'FOX',url,requested_at:r.requested_at,received_at:r.received_at,status:r.status,data:r.data});return {ok:r.ok,status:r.status,json:async()=>r.data,text:async()=>r.raw}}
    catch(e){observations.push({url,requested_at:at,error:String(e.message)});throw e}
  };
  // Separate reads retain the exact source response used for this decision.
  const passed=await verifyIndependentOver(game,milestone,{...options,cache:undefined,fetcher});
  await auditTable();const id=randomUUID();
  await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,$3,$4)',[id,options.market?.ticker||'',passed,JSON.stringify({game,milestone,observations,firstObservation:options.firstObservation})]);
  if(passed)game.verificationId=id;
  return passed;
}
async function currentSell(ticker){
  const [positions,market,book]=await Promise.all([allOpenPositions(),kalshi('/markets/'+encodeURIComponent(ticker)),kalshi('/markets/'+encodeURIComponent(ticker)+'/orderbook')]);
  const held=Number(positions.market_positions?.find(p=>p.ticker===ticker)?.position_fp||0);
  return sellQuote(book.orderbook_fp,held,market.market?.fractional_trading_enabled===false);
}
async function manualSell(body){
  if(!/^[A-Z0-9-]{1,180}$/.test(body.ticker||'')||!Number.isFinite(body.price)||body.price<=0||body.price>=1||!/^[0-9a-f-]{36}$/.test(body.id||''))return json({error:'Invalid sale'},400);
  await pool.query(`CREATE TABLE IF NOT EXISTS manual_sales(id uuid PRIMARY KEY,ticker text NOT NULL,status text NOT NULL,result jsonb,created_at timestamptz DEFAULT now())`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['sell:'+body.ticker]);
    const existing=await client.query("SELECT * FROM manual_sales WHERE id=$1 OR (ticker=$2 AND status='pending')",[body.id,body.ticker]);
    if(existing.rows.length){
      const old=existing.rows[0];
      if(old.status==='pending'){
        const history=await kalshi('/portfolio/orders?'+new URLSearchParams({ticker:body.ticker,limit:'1000'}),{auth:true});
        const found=(history.orders||[]).find(o=>o.client_order_id===old.id);
        if(found&&['executed','canceled','cancelled'].includes(found.status)){
          await client.query("UPDATE manual_sales SET status='complete',result=$2 WHERE id=$1",[old.id,JSON.stringify(found)]);await client.query('COMMIT');
          return json({ok:true,filled:Number(found.fill_count_fp??found.fill_count??0)});
        }
      }
      await client.query('ROLLBACK');return json({error:'Sale already submitted; awaiting reconciliation'},409)
    }
    const q=await currentSell(body.ticker);
    if(!q||q.price<body.price){await client.query('ROLLBACK');return json({error:'Sale price changed or no buyer is available. Refresh and try again.'},409)}
    await client.query("INSERT INTO manual_sales(id,ticker,status) VALUES($1,$2,'pending')",[body.id,body.ticker]);await client.query('COMMIT');
    try{
      const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:body.ticker,client_order_id:body.id,side:'ask',count:q.count.toFixed(2),price:body.price.toFixed(4),time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,reduce_only:true}});
      await pool.query("UPDATE manual_sales SET status='complete',result=$2 WHERE id=$1",[body.id,JSON.stringify(result)]);await invalidateBalance();
      return json({ok:true,filled:Number(result.fill_count_fp??result.fill_count??result.order?.fill_count_fp??0)});
    }catch(e){return json({error:'Sale response uncertain. It has been recorded; do not resubmit.'},502)}
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release()}
}
async function syncTradeHistory(settlements){
  const {rows:[config]}=await pool.query('SELECT started_at FROM trade_history_config WHERE id=1');
  if(!config)return;
  const {rows:pending}=await pool.query(`SELECT a.id,a.market_ticker,a.sport,a.order_id,a.fill_count,a.created_at,a.combo_legs,
      g.sport_family,COALESCE(g.title,'Sports game') AS teams
    FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id
    WHERE a.created_at>=$1 AND a.status='filled' AND NOT EXISTS (SELECT 1 FROM trade_history h WHERE h.id=a.id)
    ORDER BY a.created_at DESC LIMIT 500`,[config.started_at]);
  if(!pending.length)return;
  const settled=new Map(settlements.map(item=>[item.ticker,item]));
  const aged=pending.filter(item=>!settled.has(item.market_ticker)&&Date.now()-new Date(item.created_at).getTime()>47*3600000);
  if(aged.length){const start=(Math.floor(Date.now()/30000)*5)%aged.length;
    for(let i=0;i<Math.min(5,aged.length);i++){
      const ticker=aged[(start+i)%aged.length].market_ticker;
      const result=await kalshi('/portfolio/settlements?'+new URLSearchParams({ticker,limit:'100'}),{auth:true});
      const match=(result.settlements||[]).find(item=>item.ticker===ticker);
      if(match)settled.set(ticker,match);
    }
  }
  const allFills=[];
  const uniqueTickers=[...new Set(pending.map(item=>item.market_ticker))];
  for(let i=0;i<uniqueTickers.length;i+=100){
    const tickers=uniqueTickers.slice(i,i+100);
    let cursor='',complete=false;
    for(let pageNumber=0;pageNumber<10;pageNumber++){
      const query=new URLSearchParams({ticker:tickers.join(','),min_ts:String(Math.floor(new Date(config.started_at).getTime()/1000)),limit:'1000'});
      if(cursor)query.set('cursor',cursor);
      const result=await kalshi('/portfolio/fills?'+query,{auth:true});
      allFills.push(...result.fills||[]);cursor=result.cursor||'';
      if(!cursor){complete=true;break}
    }
    if(!complete)throw Error('Trade history fills exceed pagination safety limit');
  }
  for(const entry of pending){
    const completed=completedTrade(entry,allFills,settled.get(entry.market_ticker));
    if(!completed)continue;
    const sport=([['basketball','Basketball'],['hockey','Hockey'],['football','Football'],['baseball','Baseball'],['soccer','Soccer'],['tennis','Tennis']]
      .find(([family])=>String(entry.sport_family||'').includes(family))||[])[1]||entry.sport;
    await pool.query(`INSERT INTO trade_history(id,market_ticker,sport,teams,occurred_at,profit_cents,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
      [entry.id,entry.market_ticker,entry.combo_legs?.length?`${entry.combo_legs.length}-pick combo`:sport,
        entry.combo_legs?.length?entry.combo_legs.map(l=>l.title).join(' / '):entry.teams,completed.occurredAt,completed.profitCents,completed.outcome]);
  }
}
async function syncSettlementAlerts(){
  if(!configured())return;
  // A second scanner instance cannot poll and enqueue the same records simultaneously.
  const claim=await pool.query(`UPDATE settlement_poll SET last_check=now() WHERE id=1 AND last_check<now()-interval '30 seconds' RETURNING id`);
  if(!claim.rowCount)return;
  try{
    const observedSettlements=[];
    const held=await pool.query(`SELECT DISTINCT market_ticker FROM trade_attempts WHERE status='filled' AND created_at>now()-interval '14 days'`);
    const tickers=new Set(held.rows.map(r=>r.market_ticker));
    if(tickers.size){
      let cursor='';const minTs=Math.floor(Date.now()/1000)-48*3600;
      for(let pageNumber=0;pageNumber<5;pageNumber++){
        const query=new URLSearchParams({limit:'1000',min_ts:String(minTs)});if(cursor)query.set('cursor',cursor);
        const result=await kalshi('/portfolio/settlements?'+query,{auth:true});
        observedSettlements.push(...result.settlements||[]);
        for(const s of result.settlements||[]){
          if(!tickers.has(s.ticker))continue;
          const profit=favorableSettlement(s),settled=new Date(s.settled_time);
          if(!profit||!Number.isFinite(settled.getTime()))continue;
          const inserted=await pool.query(`INSERT INTO settlement_alerts(ticker,settled_time,profit_cents) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,[s.ticker,settled,profit]);
          if(inserted.rows[0])await pool.query(`INSERT INTO push_deliveries(alert_id,endpoint) SELECT $1,endpoint FROM push_subscriptions WHERE created_at<=$2 ON CONFLICT DO NOTHING`,[inserted.rows[0].id,settled]);
        }
        cursor=result.cursor||'';if(!cursor)break;
      }
    }
    try{await syncTradeHistory(observedSettlements)}catch(e){console.error('Trade history reconciliation deferred:',e)}
  }catch(e){console.error('Settlement polling failed:',e);await pool.query(`UPDATE settlement_poll SET last_check=to_timestamp(0) WHERE id=1`).catch(()=>{})}
  const due=await pool.query(`SELECT d.alert_id,d.endpoint,s.subscription,a.ticker,a.profit_cents FROM push_deliveries d JOIN push_subscriptions s USING(endpoint) JOIN settlement_alerts a ON a.id=d.alert_id WHERE d.status='pending' AND d.next_attempt<=now() ORDER BY d.alert_id LIMIT 15`);
  await Promise.all(due.rows.map(async row=>{
    try{
      const status=await deliverPush(row.subscription,{type:'profitable-settlement',id:row.alert_id,body:`${row.ticker} settled profitably · $${(row.profit_cents/100).toFixed(2)} net`},pushIdentity());
      if(status===201||status===202)await pool.query(`UPDATE push_deliveries SET status='sent',attempts=attempts+1 WHERE alert_id=$1 AND endpoint=$2`,[row.alert_id,row.endpoint]);
      else if(status===404||status===410)await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[row.endpoint]);
      else throw Error(`Push provider returned ${status}`);
    }catch(e){console.error('Push delivery failed:',String(e.message));await pool.query(`UPDATE push_deliveries SET attempts=attempts+1,next_attempt=now()+interval '1 minute'*LEAST(60,power(2,LEAST(attempts,6))) WHERE alert_id=$1 AND endpoint=$2`,[row.alert_id,row.endpoint]).catch(()=>{})}
  }));
}
async function allOpenPositions(){
  const market_positions=[];let cursor='';
  for(let page=0;page<100;page++){
    const q=new URLSearchParams({settlement_status:'unsettled',count_filter:'position',limit:'1000'});
    if(cursor)q.set('cursor',cursor);
    const result=await kalshi('/portfolio/positions?'+q,{auth:true});
    market_positions.push(...(result.market_positions||[]));
    cursor=result.cursor||'';if(!cursor)return {market_positions};
  }
  throw Error('Open positions exceed the pagination safety limit');
}
async function milestones(){
  const found=[];let cursor='';const now=Date.now(),min=new Date(now-36*3600000).toISOString();
  for(let i=0;i<20;i++){
    const q=new URLSearchParams({category:'Sports',limit:'500',minimum_start_date:min});if(cursor)q.set('cursor',cursor);
    const x=await kalshi('/milestones?'+q),page=x.milestones||[];found.push(...page);cursor=x.cursor;
    // Milestones are returned by start time. Stop once the next page is future-only.
    if(!cursor||page.length&&new Date(page.at(-1).start_date).getTime()>now+3600000)break;
    if(i===19)throw Error('Sports milestones exceed the pagination safety limit before current games');
  }
  const golf=await kalshi('/milestones?'+new URLSearchParams({category:'Sports',type:'golf_tournament',minimum_start_date:new Date(now-7*86400000).toISOString(),limit:'100'})).catch(e=>{console.warn('Golf discovery unavailable:',e.message);return {milestones:[]}});
  const ids=new Set(found.map(m=>m.id));for(const m of golf.milestones||[])if(!ids.has(m.id))found.push(m);
  return found.filter(m=>m.id && new Date(m.start_date).getTime()<now+3600000 && (!m.end_date||new Date(m.end_date).getTime()>now-3600000));
}
async function liveBatch(ms){
  const map=new Map();for(let i=0;i<ms.length;i+=40){const groups=[ms.slice(i,i+20),ms.slice(i+20,i+40)].filter(g=>g.length);
    const results=await Promise.all(groups.map(async group=>{const q=new URLSearchParams();group.forEach(m=>q.append('milestone_ids',m.id));q.set('include_player_stats','true');
    let list=[];try{list=(await kalshi('/live_data/batch?'+q)).live_datas||[]}catch(e){
      if(!/^Kalshi (400|404|405) /.test(String(e.message)))throw e;
      console.warn('Live batch unsupported; using bounded individual requests:',e.message);
      for(const m of group){try{let result;try{result=await kalshi('/live_data/milestone/'+encodeURIComponent(m.id)+'?include_player_stats=true')}catch(error){if(!/^Kalshi (400|404) /.test(String(error.message)))throw error;result=await kalshi('/live_data/milestone/'+encodeURIComponent(m.id))}if(result.live_data)list.push(result.live_data)}catch(error){if(/Kalshi 429 /.test(String(error.message)))throw error}}
    }
    return {list,observedAt:new Date().toISOString()};}));
    results.forEach(({list,observedAt})=>list.forEach(d=>map.set(d.milestone_id,{...d,_observed_at:observedAt})));}
  return map;
}
async function liveMilestone(id){
  const path='/live_data/milestone/'+encodeURIComponent(id);
  try{return (await kalshi(path+'?include_player_stats=true')).live_data}
  catch(e){if(!/^Kalshi (400|404) /.test(String(e.message)))throw e;return (await kalshi(path)).live_data}
}
async function marketMap(tickers){
  const map=new Map();const list=[...new Set(tickers)].filter(Boolean);
  for(let i=0;i<list.length;i+=70){const chunks=[list.slice(i,i+35),list.slice(i+35,i+70)].filter(c=>c.length);
    const results=await Promise.all(chunks.map(chunk=>kalshi('/events?'+new URLSearchParams({tickers:chunk.join(','),with_nested_markets:'true',limit:'200',status:'open'}))));
    for(const result of results)for(const e of result.events||[])map.set(e.event_ticker,e);
  }return map;
}
async function reserve(signal,game,event,market,count,price,balance){
  const id=randomUUID();
  const {rowCount}=await pool.query(`INSERT INTO trade_attempts(id,market_ticker,event_ticker,game_id,sport,strategy,reason,fraction,count,limit_price,available_cents)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(market_ticker,strategy) DO UPDATE SET
      id=EXCLUDED.id,event_ticker=EXCLUDED.event_ticker,game_id=EXCLUDED.game_id,sport=EXCLUDED.sport,
      reason=EXCLUDED.reason,fraction=EXCLUDED.fraction,count=EXCLUDED.count,limit_price=EXCLUDED.limit_price,available_cents=EXCLUDED.available_cents,
      status='reserved',order_id=NULL,fill_count=0,retries=0,ai_review=NULL,error=NULL,created_at=now(),updated_at=now(),
      attempt_history=trade_attempts.attempt_history||jsonb_build_array(jsonb_build_object('id',trade_attempts.id,'status',trade_attempts.status,'order_id',trade_attempts.order_id,'error',trade_attempts.error,'count',trade_attempts.count,'fill_count',trade_attempts.fill_count,'created_at',trade_attempts.created_at))
    WHERE (trade_attempts.status='unfilled' AND trade_attempts.updated_at<now()-interval '2 seconds')
       OR (trade_attempts.status='rejected' AND trade_attempts.updated_at<now()-interval '15 seconds'
           AND ((trade_attempts.error ILIKE '%insufficient%' AND EXCLUDED.available_cents>trade_attempts.available_cents)
                OR (trade_attempts.error ILIKE '%price%' AND EXCLUDED.limit_price<>trade_attempts.limit_price)))`,
    [id,market.ticker,event.event_ticker,game.id,game.sport,signal.strategy,signal.reason,signal.fraction,count,price,Math.floor(balance)]);
  return rowCount?id:null;
}
function feeReserve(event,market){return Math.max(2,Number(process.env.FEE_MULTIPLIER_RESERVE)||2,2*Number(event?.fee_multiplier_override||0),2*Number(market?.fee_multiplier_override||0))}
const minimumCount=market=>market.fractional_trading_enabled===false?1:0.01;
const hasAsk=market=>Number.isFinite(Number(market.yes_ask_size_fp))&&Number(market.yes_ask_size_fp)>=minimumCount(market);
async function executableQuote(market){
  // A market's advertised best ask can disappear before a FOK order crosses.
  // NO bids are the resting YES offers; use only depth at or below this ask.
  const {orderbook_fp}=await kalshi('/markets/'+encodeURIComponent(market.ticker)+'/orderbook');
  const available=yesDepthAtAsk(orderbook_fp,market.yes_ask_dollars,market.yes_ask_size_fp);
  return available>=minimumCount(market)?{...market,yes_ask_size_fp:String(available)}:null;
}
const askProbe=new Map();
async function recoverSummaryAsk(market){
  if(hasAsk(market))return market;
  const cached=askProbe.get(market.ticker);
  if(cached&&Date.now()-cached.at<10000)return cached.quote?{...market,...cached.quote}:market;
  try{
    const {orderbook_fp}=await kalshi('/markets/'+encodeURIComponent(market.ticker)+'/orderbook');
    const best=bestYesAsk(orderbook_fp);
    const quote=best?{yes_ask_dollars:best.price.toFixed(4),yes_ask_size_fp:best.size.toFixed(2)}:null;
    askProbe.set(market.ticker,{at:Date.now(),quote});
    return quote?{...market,...quote}:market;
  }catch(e){console.warn('Ask depth probe unavailable:',market.ticker,e.message);return market}
}
function contractCount(balance,market,fraction,bankroll,budget,fees){
  const count=orderSize(balance,market.yes_ask_dollars,market.yes_ask_size_fp,fraction,Number(process.env.MAX_YES_PRICE||1),bankroll,budget,fees);
  return market.fractional_trading_enabled===false?Math.floor(count):count;
}
function executableCount(c,balance,bankroll,overRemaining){
  const fees=feeReserve(c.event,c.market),price=Number(c.market.yes_ask_dollars);
  const count=contractCount(balance,c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
  return profitableCount(count,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds);
}
const signalKey=c=>`${c.market.ticker}:${c.signal.strategy}`;
function signalExecution(c,filled,account,balance,bankroll,overRemaining){
  if(filled.has(signalKey(c)))return 'Already filled';
  if(!hasAsk(c.market))return 'No ask liquidity';
  if(!account)return 'Trading paused';
  const price=Number(c.market.yes_ask_dollars),fees=feeReserve(c.event,c.market);
  const raw=contractCount(balance,c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
  if(!raw)return 'Insufficient budget or price above cap';
  if(!profitableCount(raw,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds))return 'Below minimum net profit after fees';
  const local=shardCash(account,marketShard(c.event,c.market));
  if(local===null)return 'Shard balance unavailable';
  if(local<estimatedCostCents(raw,price,fees)){
    if(transferPlan(account,marketShard(c.event,c.market),estimatedCostCents(raw,price,fees)))return 'Awaiting shard funding';
    const localCount=contractCount(Math.min(balance,local),c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
    if(!profitableCount(localCount,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds))return 'Insufficient shard cash';
  }
  return c.signal.strategy==='over'?'Awaiting independent score confirmation':'Eligible for final verification';
}
async function ensureShardFunding(signal,event,market,account,desiredCents){
  const destination=marketShard(event,market);
  const plan=transferPlan(account,destination,desiredCents);
  if(!plan)return false;
  const {rows:[pending]}=await pool.query(`SELECT * FROM funding_transfers WHERE market_ticker=$1 AND strategy=$2 AND status IN ('pending','uncertain') ORDER BY created_at DESC LIMIT 1`,[market.ticker,signal.strategy]);
  // Funding belongs to the destination shard, not a market. Do not queue
  // competing transfers against the same source cash while one is settling.
  if(!pending){const inFlight=await pool.query(`SELECT id FROM funding_transfers WHERE status IN ('pending','uncertain') AND destination_shard=$1 LIMIT 1`,[destination]);if(inFlight.rowCount)return false}
  if(pending){
    const history=await kalshi('/portfolio/intra_exchange_instance_transfers?limit=100',{auth:true});
    const matched=(history.transfers||[]).find(t=>t.client_transfer_id===pending.id);
    if(matched?.status==='complete'){
      await pool.query(`UPDATE funding_transfers SET status='complete',transfer_id=$2,updated_at=now() WHERE id=$1`,[pending.id,matched.transfer_id]);await invalidateBalance();return false;
    }
    return false; // An uncertain transfer must be reconciled, never resubmitted blindly.
  }
  const id=pending?.id||randomUUID(),amount=pending?.amount_centicents||plan.amountCenticents;
  if(Number(amount)<100)return false;
  if(!pending)await pool.query(`INSERT INTO funding_transfers(id,market_ticker,strategy,source_shard,destination_shard,amount_centicents) VALUES($1,$2,$3,$4,$5,$6)`,[id,market.ticker,signal.strategy,plan.sourceShard,destination,amount]);
  try{
    const result=await kalshi('/portfolio/intra_exchange_instance_transfer',{method:'POST',auth:true,body:{source:'event_contract',destination:'event_contract',amount:Number(amount),client_transfer_id:id,source_exchange_shard:pending?.source_shard??plan.sourceShard,destination_exchange_shard:destination,source_subaccount:0,destination_subaccount:0}});
    await pool.query(`UPDATE funding_transfers SET status='pending',transfer_id=$2,error=NULL,updated_at=now() WHERE id=$1`,[id,result.transfer_id||null]);
  }catch(e){
    await pool.query(`UPDATE funding_transfers SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,/^Kalshi (400|401|403|404) /.test(String(e.message))?'blocked':'uncertain',String(e.message).slice(0,250)]);
    throw e;
  }
  return false; // Transfers are asynchronous; the next scan checks actual shard cash.
}
async function reconcileFundingTransfers(){
  const pending=await pool.query(`SELECT id,transfer_id FROM funding_transfers WHERE status IN ('pending','uncertain') AND updated_at<now()-interval '10 seconds' ORDER BY created_at DESC LIMIT 100`);
  if(!pending.rowCount)return;
  const history=await kalshi('/portfolio/intra_exchange_instance_transfers?limit=500',{auth:true});
  const completed=(history.transfers||[]).filter(t=>t.status==='complete');
  for(const row of pending.rows){const match=completed.find(t=>t.client_transfer_id===row.id||row.transfer_id&&t.transfer_id===row.transfer_id);
    if(match){await pool.query(`UPDATE funding_transfers SET status='complete',transfer_id=$2,updated_at=now() WHERE id=$1`,[row.id,match.transfer_id]);await invalidateBalance()}}
}
async function submit(signal,game,event,market,balance,bankroll,budgetCents=Infinity,availableCents=bankroll){
  const price=Number(market.yes_ask_dollars);const count=profitableCount(contractCount(balance,market,signal.fraction,bankroll,budgetCents,feeReserve(event,market)),price,feeReserve(event,market),signal.strategy,availableCents,game.type,game.remainingSeconds);if(!count)return false;
  if(['over','weather'].includes(signal.strategy)&&!game.verificationId)return false;
  const active=await pool.query(`SELECT 1 FROM trade_attempts WHERE market_ticker=$1 AND status IN ('filled','reserved','check_order','retrying','combo_pending') LIMIT 1`,[market.ticker]);
  if(active.rowCount)return false;
  const id=await reserve(signal,game,event,market,count,price,balance);if(!id)return false;
  await pool.query(`CREATE TABLE IF NOT EXISTS order_verifications(order_id uuid PRIMARY KEY,verification_id uuid NOT NULL,created_at timestamptz DEFAULT now())`);
  if(game.verificationId)await pool.query('INSERT INTO order_verifications(order_id,verification_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,game.verificationId]);
  try{
    // A partial IOC fill can be below the minimum net profit. Require the
    // entire quantity at the limit price or no entry at all.
    const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:market.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    const filled=Number(result.fill_count_fp??result.fill_count??result.order?.fill_count_fp??0);
    await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[id,filled>0?'filled':'unfilled',result.order_id||result.order?.order_id||null,filled]);
    if(filled>0)await invalidateBalance();
    return filled>0;
  }catch(e){const message=String(e.message),noLiquidity=/^Kalshi 409 .*fill or kill insufficient resting volume/i.test(message),terminal=/^Kalshi (400|401|403|404|422) /.test(message);await pool.query(`UPDATE trade_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,noLiquidity?'unfilled':terminal?'rejected':'check_order',message.slice(0,250)]);if(/insufficient balance/i.test(message))await invalidateBalance();console.error('Order response:',market.ticker,e.message);return false}
}
async function recoverPending(signal,game,event,market,balance,bankroll,budgetCents=Infinity,availableCents=bankroll){
  const {rows:[row]}=await pool.query(`SELECT * FROM trade_attempts WHERE market_ticker=$1 AND strategy=$2 AND status IN ('check_order','reserved')`,[market.ticker,signal.strategy]);
  if(!row)return false;
  // Never send a second order until the exchange has been queried for the original client ID.
  try{
    let cursor='',matched,complete=false;
    for(let page=0;page<5;page++){
      const query=new URLSearchParams({ticker:market.ticker,min_ts:String(Math.floor(new Date(row.created_at).getTime()/1000)-60),limit:'1000'});
      if(cursor)query.set('cursor',cursor);
      const orders=await kalshi('/portfolio/orders?'+query,{auth:true});
      matched=(orders.orders||[]).find(o=>o.client_order_id===row.id);
      if(matched){complete=true;break}
      cursor=orders.cursor||'';
      if(!cursor){complete=true;break}
    }
    if(!complete){console.warn('Order history still paginated; retry deferred:',market.ticker);return false}
    if(matched){const filled=Number(matched.fill_count_fp??matched.fill_count??0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',matched.order_id||null,filled]);return filled>0}
  }catch(e){console.warn('Order history unavailable; retry deferred:',e.message);return false}
  if(row.retries || Date.now()-new Date(row.updated_at).getTime()<15000)return false;
  // The supervisor reviews a missing submission. An unavailable model falls back to one bounded deterministic retry.
  let review;try{review=await reviewMiss({signal,game,market,error:row.error})}catch(e){review={available:false,retry:true,reason:'AI unavailable: '+e.message}}
  if(!review.retry){await pool.query(`UPDATE trade_attempts SET status='needs_review',ai_review=$2,updated_at=now() WHERE id=$1`,[row.id,review.reason]);return false}
  if(Number(row.count)>contractCount(balance,{...market,yes_ask_dollars:row.limit_price},signal.fraction,bankroll,budgetCents,feeReserve(event,market))||
    !profitableCount(Number(row.count),Number(row.limit_price),feeReserve(event,market),signal.strategy,availableCents,game.type,game.remainingSeconds))return false;
  const claim=await pool.query(`UPDATE trade_attempts SET retries=1,status='retrying',ai_review=$2,updated_at=now() WHERE id=$1 AND status IN ('check_order','reserved') AND retries=0 RETURNING id`,[row.id,review.reason]);
  if(!claim.rowCount)return false;
  try{const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:row.market_ticker,client_order_id:row.id,side:'bid',count:Number(row.count).toFixed(2),price:Number(row.limit_price).toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    const filled=Number(result.fill_count||0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',result.order_id||null,filled]);return filled>0
  }catch(e){await pool.query(`UPDATE trade_attempts SET status='check_order',error=$2,updated_at=now() WHERE id=$1`,[row.id,'Recovery response uncertain: '+String(e.message).slice(0,200)]);return false}
}
async function reconcileCombos(){
  const pending=await pool.query(`SELECT id,market_ticker,combo_rfq_id,combo_quote_id,created_at FROM trade_attempts
    WHERE status='combo_pending' AND combo_quote_id IS NOT NULL ORDER BY created_at LIMIT 20`);
  for(const row of pending.rows){
    try{
      const path='/communications/rfqs/'+encodeURIComponent(row.combo_rfq_id)+'/quotes/'+encodeURIComponent(row.combo_quote_id);
      const quote=(await kalshi(path,{auth:true})).quote;
      if(!quote)continue;
      if(quote.status==='executed' && quote.executed_ts){
        const orderId=quote.rfq_creator_order_id;
        if(!orderId)continue;
        // Confirm actual account fills; quote acceptance by itself is not execution.
        const fills=await kalshi('/portfolio/fills?'+new URLSearchParams({ticker:row.market_ticker,min_ts:String(Math.floor(new Date(row.created_at).getTime()/1000)-60),limit:'1000'}),{auth:true});
        const mine=(fills.fills||[]).filter(f=>f.ticker===row.market_ticker && f.order_id===orderId && new Date(f.created_time||f.ts||0)>=new Date(row.created_at));
        const count=mine.reduce((sum,f)=>sum+Number(f.count_fp??f.count??0),0);
        if(count>0){await pool.query(`UPDATE trade_attempts SET status='filled',fill_count=$2,order_id=$3,updated_at=now() WHERE id=$1`,[row.id,count,orderId||null]);await invalidateBalance()}
      }else if(['cancelled','expired','rejected','voided'].includes(quote.status) ||
        (Date.now()-new Date(row.created_at).getTime()>90000 && quote.status==='open')){
        await pool.query(`UPDATE trade_attempts SET status='unfilled',updated_at=now() WHERE id=$1`,[row.id]);
      }
    }catch(e){console.warn('Combo reconciliation deferred:',row.market_ticker,e.message)}
  }
}
async function executeCombo(group,account,bankroll,overRemaining,scoreboardCache){
  if(group.length<2)return {filled:false,pending:false};
  // The verification window begins with a fresh observation of every leg.
  const verified=await Promise.all(group.map(async c=>{
    try{
      if(c.signal.strategy==='over'){
        const dwell=COMBO_WINDOW_MS;
        const remaining=dwell-(Date.now()-c.state.observedAt);
        if(!Number.isFinite(remaining))return null;
        if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      }
      const liveData=await liveMilestone(c.milestone.id);
      if(!liveData)return null;
      liveData._observed_at=new Date().toISOString();
      const state=gameState(c.milestone,liveData);
      if(c.signal.strategy==='over'){
        if(!confirmedOver(c.state,state,c.market)||!await auditedOver(state,c.milestone,{cache:scoreboardCache,market:c.market,firstObservation:c.state}))return null;
      }else if(/basketball/.test(c.state.type) && (state.period!==c.state.period||!state.periodConsistent||state.remainingSeconds>c.state.remainingSeconds))return null;
      const market=(await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market;
      if(!market||market.ticker!==c.market.ticker||market.event_ticker!==c.event.event_ticker)return null;
      if(state.golf&&!await verifyGolf(state,c.milestone,c.event))return null;
      const signal=c.signal.strategy==='over'?overSignal(state,market):golfSignal(state,market)||leadSignal(state,market)||additionalLeadSignal(state,market)||tennisSignal(state,market)||tableTennisSignal(state,market);
      return signal?{...c,state,market,signal}:null;
    }catch(e){console.warn('Combo leg verification:',c.market.ticker,e.message);return null}
  }));
  const seenGames=new Set(),seenEvents=new Set();
  const eligible=verified.filter(Boolean).filter(c=>{
    if(seenGames.has(c.milestone.id)||seenEvents.has(c.event.event_ticker))return false;
    seenGames.add(c.milestone.id);seenEvents.add(c.event.event_ticker);return true;
  }).slice(0,10);
  if(eligible.length<2)return {filled:false,pending:false};
  // Prefer all available verified legs, then smaller valid combinations.
  const collections=(await kalshi('/multivariate_event_collections?'+new URLSearchParams({status:'open',limit:'100'}))).multivariate_contracts||[];
  const deadline=Date.now()+COMBO_WINDOW_MS;
  const plans=[],funding=[];
  // Request executable quotes for all available ticket sizes in the same
  // bounded window. A six-pick market may have no maker while a three-pick does.
  await Promise.all(compatibleComboGroups(collections,eligible).map(async ({legs,collection})=>{
    const n=legs.length;
    try{
      const identifiers=legs.map(c=>({event_ticker:c.event.event_ticker,market_ticker:c.market.ticker}));
      const created=await kalshi('/multivariate_event_collections/'+encodeURIComponent(collection.collection_ticker),{auth:true,method:'POST',body:{selected_markets:identifiers,with_market_payload:true}});
      const ticker=created.market_ticker,combo=created.market;
      if(!ticker||!combo||combo.ticker!==ticker||combo.event_ticker!==created.event_ticker||!['active','open'].includes(combo.status))return;
      const strategy=legs.some(c=>c.signal.strategy==='over')?'over':'lead';
      const fraction=.10; // A separate bounded combo budget preserves cash for mixed tickets.
      const shard=marketShard({exchange_index:collection.exchange_index},combo),local=shardCash(account,shard);
      const desired=Math.floor(Math.min(Number(account.balance),bankroll*fraction,strategy==='over'?overRemaining:Infinity));
      if(local===null||desired<100)return;
      if(local<desired&&transferPlan(account,shard,desired)){funding.push({strategy,created,combo,desired});return}
      const budget=Math.floor(Math.min(desired,local));
      if(budget<100)return;
      const existing=await pool.query(`SELECT status FROM trade_attempts WHERE market_ticker=$1`,[ticker]);
      if(existing.rows.some(r=>['filled','combo_pending','reserved','check_order'].includes(r.status)))return;
      if(Date.now()>=deadline)return;
      const rfq=(await kalshi('/communications/rfqs',{auth:true,method:'POST',body:{market_ticker:ticker,target_cost_dollars:(budget/100).toFixed(2),rest_remainder:false,obscure_creator_id:true}})).id;
      if(rfq)plans.push({legs,created,ticker,combo,strategy,fraction,shard,budget,rfq});
    }catch(e){console.warn('Combo size unavailable:',n,e.message)}
  }));
  if(!plans.length){if(funding.length){const p=funding[0];await ensureShardFunding({strategy:p.strategy},p.created,p.combo,account,p.desired)}return {filled:false,pending:false}}
  try{
    while(Date.now()<deadline){
      const offers=(await Promise.all(plans.map(async plan=>{
        try{
          const list=(await kalshi('/communications/quotes?'+new URLSearchParams({rfq_id:plan.rfq,limit:'100'}),{auth:true})).quotes||[];
          const fees=feeReserve({fee_multiplier_override:plan.combo.fee_multiplier_override},plan.combo);
          return list.map(q=>({plan,q,terms:quoteForYes(q,plan.ticker,plan.budget,fees,bankroll),fees})).filter(x=>x.terms&&
            profitableCount(x.terms.count,x.terms.yesCost,fees,plan.strategy,bankroll,plan.legs[0].state.type,plan.legs[0].state.remainingSeconds));
        }catch(e){console.warn('Combo quotes unavailable:',plan.ticker,e.message);return []}
      }))).flat().sort((a,b)=>b.terms.profitCents-a.terms.profitCents||b.plan.legs.length-a.plan.legs.length);
      if(offers.length){
        const {q,terms,plan,fees}=offers[0],{legs,ticker,strategy,fraction,shard,rfq,created}=plan;
        // Refresh every leg immediately before accepting a quote. A goal correction
        // or changed leader invalidates the entire combination.
        const fresh=await liveBatch(legs.map(c=>c.milestone));
        if(legs.some(c=>{
          const d=fresh.get(c.milestone.id),s=gameState(c.milestone,d);
          return c.signal.strategy==='over'?!overSignal(s,c.market)||s.home!==c.state.home||s.away!==c.state.away||
            s.period<c.state.period||s.soccerMinute<c.state.soccerMinute||/^tennis_/.test(s.type)&&s.tennisTotal!==c.state.tennisTotal:!(golfSignal(s,c.market)||leadSignal(s,c.market)||additionalLeadSignal(s,c.market)||tennisSignal(s,c.market)||tableTennisSignal(s,c.market));
        }))break;
        const checks=await Promise.all(legs.filter(c=>c.signal.strategy==='over'||c.state.golf).map(c=>c.state.golf?verifyGolf(gameState(c.milestone,fresh.get(c.milestone.id)),c.milestone,c.event):auditedOver(gameState(c.milestone,fresh.get(c.milestone.id)),c.milestone,{market:c.market,firstObservation:c.state,cache:scoreboardCache})));
        if(checks.some(ok=>!ok)||Date.now()>=deadline)break;
        if(Date.now()>=deadline)break;
        const latest=await accountBalance({fresh:true});
        if(Number(latest.balance)<terms.debitCents || (shardCash(latest,shard)??0)<terms.debitCents ||
          terms.debitCents>Math.floor((Number(latest.balance)+Number(latest.portfolio_value))*fraction) ||
          strategy==='over'&&terms.debitCents>overRemaining ||
          !profitableCount(terms.count,terms.yesCost,fees,strategy,Number(latest.balance)+Number(latest.portfolio_value),legs[0].state.type,legs[0].state.remainingSeconds))break;
        const id=randomUUID(),reason=`${legs.length}-pick ${strategy} combo: ${legs.map(c=>c.state.title).join(' / ')}`;
        const inserted=await pool.query(`INSERT INTO trade_attempts(id,market_ticker,event_ticker,game_id,sport,strategy,reason,fraction,count,limit_price,available_cents,status,combo_legs,combo_rfq_id,combo_quote_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'combo_pending',$12,$13,$14)
          ON CONFLICT DO NOTHING RETURNING id`,
          [id,ticker,created.event_ticker,legs[0].milestone.id,legs[0].state.sport,strategy,reason,fraction,terms.count,terms.yesCost,Number(latest.balance),JSON.stringify(comboLegs(legs)),rfq,q.id]);
        if(!inserted.rowCount)break;
        try{
          // Accepting the maker's NO bid buys YES (the complementary price).
          await kalshi('/communications/rfqs/'+encodeURIComponent(rfq)+'/quotes/'+encodeURIComponent(q.id)+'/accept',{auth:true,method:'PUT',body:{accepted_side:'no'}});
          await reconcileCombos();
          return {filled:true,pending:true,legs};
        }catch(e){console.error('Combo accept uncertain; reconciliation required:',ticker,e.message);return {filled:false,pending:true,legs}}
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(0,deadline-Date.now()))));
    }
  }finally{await Promise.all(plans.map(p=>kalshi('/communications/rfqs/'+encodeURIComponent(p.rfq),{auth:true,method:'DELETE'}).catch(e=>console.warn('RFQ cancellation deferred:',e.message))))}
  return {filled:false,pending:false};
}
async function exitComebacks(games,events,positions){
  const byGame=new Map(games.map(g=>[g.milestone.id,g.state]));
  const markets=new Map([...events.values()].flatMap(e=>(e.markets||[]).map(m=>[m.ticker,m])));
  const marketGames=new Map(games.flatMap(g=>linkedEventTickers(g.milestone).flatMap(t=>(events.get(t)?.markets||[]).map(m=>[m.ticker,g.milestone.id]))));
  const held=(positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0);
  if(!held.length)return;
  const recorded=await pool.query(`SELECT DISTINCT ON (market_ticker) market_ticker,game_id,strategy,status,combo_legs FROM trade_attempts WHERE status='filled' ORDER BY market_ticker,updated_at DESC`);
  const ownership=new Map(recorded.rows.map(r=>[r.market_ticker,r]));
  for(const position of held){
    const original=ownership.get(position.ticker),gameId=original?.game_id||marketGames.get(position.ticker),state=byGame.get(gameId),nested=markets.get(position.ticker);
    // Never auto-sell overs or positions without a verified lead entry.
    if(original?.strategy!=='lead'||/TOTAL/i.test(position.ticker))continue;
    const strategy='lead';
    const combo=Array.isArray(original.combo_legs)&&original.combo_legs.length>=2;
    const reversed=combo?original.combo_legs.some(leg=>{
      if(leg.strategy!=='lead')return false;
      const legState=byGame.get(leg.game_id),legMarket=(events.get(leg.event_ticker)?.markets||[]).find(m=>m.ticker===leg.market_ticker);
      return legState&&legMarket&&comeback(legState,legMarket,strategy);
    }):state?.verifiedLive&&nested&&comeback(state,nested,strategy);
    if(!reversed)continue;
    try{
      const market=(await kalshi('/markets/'+encodeURIComponent(position.ticker))).market;
      if(!market||!['active','open'].includes(market.status)||!combo&&!comeback(state,market,strategy))continue;
      const bid=Number(market.yes_bid_dollars),bidSize=Number(market.yes_bid_size_fp),heldCount=Number(position.position_fp??position.position);
      if(!Number.isFinite(bid)||bid<=0||!Number.isFinite(bidSize)||bidSize<minimumCount(market))continue;
      let prior=(await pool.query('SELECT * FROM exit_attempts WHERE market_ticker=$1',[position.ticker])).rows[0];
      if(prior&&['pending','uncertain'].includes(prior.status)){
        try{
          const q=new URLSearchParams({ticker:position.ticker,min_ts:String(Math.floor(new Date(prior.created_at).getTime()/1000)-60),limit:'1000'});
          const history=await kalshi('/portfolio/orders?'+q,{auth:true});
          const match=(history.orders||[]).find(o=>o.client_order_id===prior.id);
          if(match)await pool.query(`UPDATE exit_attempts SET status=$2,order_id=$3,filled_count=$4,updated_at=now() WHERE id=$1`,[prior.id,'unfilled',match.order_id||null,Number(match.fill_count_fp??match.fill_count??0)]);
          else if(!history.cursor&&Date.now()-new Date(prior.updated_at).getTime()>15000)await pool.query(`UPDATE exit_attempts SET status='unfilled',updated_at=now() WHERE id=$1`,[prior.id]);
          else continue;
        }catch(e){console.warn('Exit reconciliation deferred:',position.ticker,e.message);continue}
      }
      const count=market.fractional_trading_enabled===false?Math.floor(Math.min(heldCount,bidSize)):Math.floor(Math.min(heldCount,bidSize)*100+1e-7)/100;
      if(count<minimumCount(market))continue;
      const id=randomUUID();
      const claim=await pool.query(`INSERT INTO exit_attempts(id,market_ticker,game_id,requested_count,limit_price,status)
        VALUES($1,$2,$3,$4,$5,'pending')
        ON CONFLICT(market_ticker) DO UPDATE SET id=EXCLUDED.id,requested_count=EXCLUDED.requested_count,
          limit_price=EXCLUDED.limit_price,status='pending',order_id=NULL,error=NULL,created_at=now(),updated_at=now()
        WHERE exit_attempts.status NOT IN ('pending','uncertain') AND exit_attempts.updated_at<now()-interval '2 seconds' RETURNING id`,
        [id,position.ticker,gameId,count,bid]);
      if(!claim.rowCount)continue;
      try{
        const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:position.ticker,client_order_id:id,side:'ask',count:count.toFixed(2),price:bid.toFixed(4),time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,reduce_only:true}});
        await pool.query(`UPDATE exit_attempts SET status='unfilled',order_id=$2,filled_count=$3,updated_at=now() WHERE id=$1`,[id,result.order_id||null,Number(result.fill_count||0)]);
        if(Number(result.fill_count)>0)await invalidateBalance();
      }catch(e){
        await pool.query(`UPDATE exit_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,/^Kalshi (400|401|403|404|422) /.test(String(e.message))?'unfilled':'uncertain',String(e.message).slice(0,250)]);
        console.error('Exit order response:',position.ticker,e.message);
      }
    }catch(e){console.error('Comeback exit deferred:',position.ticker,e.message)}
  }
}
async function nws(path){
  const response=await fetch('https://api.weather.gov'+path,{headers:{accept:'application/geo+json','user-agent':'K-Kalshi-weather-verification (station observations)'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error(`NWS ${response.status}`);
  return response.json();
}
async function executeVerifiedWeather(verified){
  if(!live())return;
  const event=verified[0].event;
  const duplicate=await pool.query(`SELECT 1 FROM trade_attempts WHERE event_ticker=$1 AND strategy='weather' AND status IN ('filled','reserved','check_order','retrying') LIMIT 1`,[event.event_ticker]);
  if(duplicate.rowCount)return;
  const account=await accountBalance({fresh:true}),balance=Number(account.balance),bankroll=balance+Number(account.portfolio_value);
  const ranked=verified.map(item=>{
    const fee=feeReserve(event,item.market);
    const count=profitableCount(contractCount(balance,item.market,.15,bankroll,Infinity,fee),Number(item.market.yes_ask_dollars),fee,'weather',bankroll);
    return {...item,profit:netSettlementProfitCents(count,Number(item.market.yes_ask_dollars),fee)};
  }).sort((a,b)=>b.profit-a.profit);
  for(const item of ranked){
    if(item.profit<50)continue;
    const latestMarket=(await kalshi('/markets/'+encodeURIComponent(item.market.ticker))).market;
    if(!latestMarket||latestMarket.rules_primary!==item.market.rules_primary||latestMarket.close_time!==item.market.close_time||
      !weatherContract(event,latestMarket,{id:item.contract.station,timezone:item.contract.timezone}))continue;
    const recovered=await recoverSummaryAsk(latestMarket);
    const quote=hasAsk(recovered)?await executableQuote(recovered):null;
    if(!quote)continue;
    const fresh=await accountBalance({fresh:true}),cash=Number(fresh.balance),total=cash+Number(fresh.portfolio_value);
    const fee=feeReserve(event,quote),count=profitableCount(contractCount(cash,quote,.15,total,Infinity,fee),Number(quote.yes_ask_dollars),fee,'weather',total);
    if(!count)continue;
    const shard=marketShard(event,quote),local=shardCash(fresh,shard),cost=estimatedCostCents(count,Number(quote.yes_ask_dollars),fee);
    if(local===null)continue;
    const signal={strategy:'weather',fraction:.15,reason:`${item.contract.type} ${item.observed.value.toFixed(2)} at ${item.contract.station} on ${item.contract.localDate}; ${item.contract.comparison} ${item.contract.threshold}`};
    if(local<cost){if(transferPlan(fresh,shard,cost))await ensureShardFunding(signal,event,quote,fresh,cost);continue}
    await auditTable();const verificationId=randomUUID();
    await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',[verificationId,quote.ticker,JSON.stringify({contract:item.contract,kalshiFirst:{at:item.firstAt,market:item.first},kalshiSecond:{at:item.secondAt,market:item.second},external:item.observed,executable:{price:quote.yes_ask_dollars,size:quote.yes_ask_size_fp,count,feeReserve:fee,projectedNetCents:netSettlementProfitCents(count,Number(quote.yes_ask_dollars),fee)}})]);
    const game={id:'weather:'+event.event_ticker,sport:'Weather',type:'weather',verificationId};
    await pool.query(`INSERT INTO game_snapshots(id,title,sport,sport_family,status,scanned_at,signals) VALUES($1,$2,'Weather','weather','live',now(),'[]')
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,scanned_at=now()`,[game.id,event.title]);
    if(await submit(signal,game,event,quote,Math.min(cash,local),total))await pool.query('UPDATE weather_scan_status SET orders_submitted=orders_submitted+1 WHERE id=1');
    break;
  }
}
async function scan(cachedMilestones){
  // A transaction-scoped lock is released by Postgres even if an invocation is terminated.
  // Snapshot writes use other pool connections so the dashboard sees each completed cycle.
  const client=await pool.connect();await client.query('BEGIN');
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(83027543) AS acquired');
  if(!lock.rows[0].acquired){await client.query('ROLLBACK');client.release();return {skipped:'scan in progress'}};
  let scanned=0,signals=0,submitted=0,ms;const executionErrors=[],scanStarted=new Date();let openPositions=null;
  try{
    if(live()||exitOnly())await reconcileCombos();
    if(live()&&!cachedMilestones)try{await reconcileFundingTransfers()}catch(e){console.warn('Transfer history unavailable:',e.message)}
    ms=cachedMilestones||await milestones();const liveMap=await liveBatch(ms);
    const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))}));
    const active=games.filter(g=>g.state.verifiedLive && g.state.scoreKnown);
    const events=await marketMap(active.filter(g=>eligibleForMarkets(g.state)).flatMap(g=>linkedEventTickers(g.milestone)));
    let balance=0,bankroll=0,overRemaining=0,account=null;
    const existingFills=await pool.query(`SELECT market_ticker,event_ticker,game_id,strategy,fill_count,limit_price,created_at,updated_at,combo_legs FROM trade_attempts WHERE status='filled'`);
    let filled=new Set(existingFills.rows.map(r=>`${r.market_ticker}:${r.strategy}`));
    const pendingLegs=await pool.query(`SELECT combo_legs FROM trade_attempts WHERE status='combo_pending' AND combo_legs IS NOT NULL`);
    for(const row of pendingLegs.rows)for(const leg of row.combo_legs||[])filled.add(`${leg.market_ticker}:${leg.strategy}`);
    if(live()||exitOnly()){
      const [currentAccount,positions]=await Promise.all([
        accountBalance(),
        allOpenPositions()
      ]);
      openPositions=positions;
      account=currentAccount;balance=Number(account.balance);
      bankroll=balance+Number(account.portfolio_value);
      const open=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
      const exposure=existingFills.rows.reduce((sum,r)=>sum+(r.strategy==='over'&&open.has(r.market_ticker)?estimatedCostCents(Number(r.fill_count),Number(r.limit_price),2):0),0);
      overRemaining=overBudget(balance,account.portfolio_value,exposure);
    }
    // Exits are assessed before any new risk is added.
    if(live()||exitOnly())await exitComebacks(games,events,openPositions);
    await candidateTable();
    const opportunities=[],snapshotRows=new Map(),scoreboardCache=new Map();
    const allCandidates=[];
    for(const {milestone,state} of games){
      const candidates=[];
      if(eligibleForMarkets(state))for(const ticker of linkedEventTickers(milestone)){const event=events.get(ticker);if(!event || event.category!=='Sports')continue;
        for(const market of event.markets||[]){if(market.event_ticker!==event.event_ticker)continue;const signal=overSignal(state,market)||golfSignal(state,market)||leadSignal(state,market)||additionalLeadSignal(state,market)||tennisSignal(state,market)||tableTennisSignal(state,market);if(signal&&!filled.has(`${market.ticker}:${signal.strategy}`))candidates.push({signal,event,market,state,milestone})}}
      allCandidates.push(...candidates);
      await Promise.all(candidates.filter(c=>!hasAsk(c.market)).slice(0,20).map(async c=>{c.market=await recoverSummaryAsk(c.market)}));
      if(state.verifiedLive)scanned++;
      const baseball=/baseball/.test(state.type),tennis=/tennis/.test(state.type),soccer=/soccer/.test(state.type);
      const timeLeft=gameTimeLabel(state);
      const preciseClockSeconds=state.verifiedLive?(soccer&&Number.isFinite(state.matchRemainingSeconds)?state.matchRemainingSeconds:soccer&&Number.isFinite(state.soccerMinute)&&state.soccerMinute<90?Math.max(0,(90-state.soccerMinute)*60):!baseball&&!tennis&&!soccer&&Number.isFinite(state.remainingSeconds)?state.remainingSeconds:null):null;
      const clockSeconds=storedClockSeconds(preciseClockSeconds,state.clockRunning);
      const clockLabel=soccer?Number.isFinite(state.matchRemainingSeconds)?'Match time left':state.soccerMinute>=90?'Stoppage time':'Regulation left':baseball?'Inning progress':tennis?'Set progress':['NCAAB','NCAAW'].includes(state.sport)? `Half ${state.period||'?'} left`:/hockey/.test(state.type)?`Period ${state.period||'?'} left`:/football|basketball/.test(state.type)?`Quarter ${state.period||'?'} left`:'Game clock';
      const displayClockLabel=clockSeconds!=null&&state.clockRunning===false?`${clockLabel} · paused`:clockLabel;
      snapshotRows.set(state.id,[state.id,state.title||'Sports game',state.sport,state.type,state.scoreKnown?state.home:null,state.scoreKnown?state.away:null,state.verifiedLive?'live':/^(final|finished|complete|completed|closed|ended)$/.test(state.status)?'final':'inactive',Number.isFinite(state.progress)?state.progress:null,String(state.period||''),timeLeft,clockSeconds,displayClockLabel,liveMap.get(milestone.id)?._observed_at||null,scanStarted,JSON.stringify(candidates.map(c=>({strategy:c.signal.strategy,reason:c.signal.reason,ticker:c.market.ticker,execution:signalExecution(c,filled,account,balance,bankroll,overRemaining)}))),state.possessionSide,state.homeTeamId||null,state.awayTeamId||null ]);
    }
    for(let i=0;i<allCandidates.length;i+=100){const batch=allCandidates.slice(i,i+100);if(!batch.length)continue;
      const values=batch.map((_,n)=>`($${2*n+1},$${2*n+2})`).join(',');
      await pool.query(`INSERT INTO candidate_windows(market_ticker,strategy) VALUES ${values} ON CONFLICT DO NOTHING`,batch.flatMap(c=>[c.market.ticker,c.signal.strategy]));
    }
    // Expire only the current ten-minute attempt. Removing the row allows a
    // still-live market to enter a new window on a later scan, including when
    // ask liquidity appears after an earlier unfilled window.
    const aged=await pool.query(`DELETE FROM candidate_windows WHERE first_seen<now()-interval '10 minutes' RETURNING market_ticker,strategy`);
    opportunities.push(...allCandidates);signals=opportunities.length;
    const snapshots=[...snapshotRows.values()];
    for(let i=0;i<snapshots.length;i+=100){
      const batch=snapshots.slice(i,i+100);
      const values=batch.map((_,row)=>'('+Array.from({length:18},(_,field)=>'$'+(row*18+field+1)).join(',')+')').join(',');
      await pool.query(`INSERT INTO game_snapshots(id,title,sport,sport_family,home,away,status,progress,period,time_left,clock_seconds,clock_label,clock_observed_at,scanned_at,signals,possession_side,home_team_id,away_team_id) VALUES ${values} ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,sport=EXCLUDED.sport,sport_family=EXCLUDED.sport_family,home=EXCLUDED.home,away=EXCLUDED.away,status=EXCLUDED.status,progress=EXCLUDED.progress,period=EXCLUDED.period,time_left=EXCLUDED.time_left,clock_seconds=EXCLUDED.clock_seconds,clock_label=EXCLUDED.clock_label,clock_observed_at=CASE WHEN game_snapshots.clock_seconds IS NOT DISTINCT FROM EXCLUDED.clock_seconds AND game_snapshots.period=EXCLUDED.period AND game_snapshots.status=EXCLUDED.status AND game_snapshots.clock_label=EXCLUDED.clock_label THEN game_snapshots.clock_observed_at ELSE EXCLUDED.clock_observed_at END,scanned_at=EXCLUDED.scanned_at,signals=EXCLUDED.signals,possession_side=EXCLUDED.possession_side,home_team_id=EXCLUDED.home_team_id,away_team_id=EXCLUDED.away_team_id WHERE game_snapshots.status IS DISTINCT FROM 'live' OR EXCLUDED.status IS DISTINCT FROM 'live' OR game_snapshots.period IS DISTINCT FROM EXCLUDED.period OR game_snapshots.clock_seconds IS NULL OR EXCLUDED.clock_seconds IS NULL OR EXCLUDED.clock_seconds<=game_snapshots.clock_seconds`,batch.flat());
    }
    // Make the live score and clock visible before slower order preflights.
    await pool.query(`UPDATE scan_status SET last_scan=$1,scanned=$2,signals=$3 WHERE id=1`,[scanStarted,scanned,signals]);
    opportunities.sort((a,b)=>{
      if(a.signal.strategy!==b.signal.strategy)return a.signal.strategy==='over'?-1:1;
      const profit=c=>netSettlementProfitCents(executableCount(c,balance,bankroll,overRemaining),Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
      return profit(b)-profit(a) || (a.signal.strategy==='lead'?Number(tieRefundPreference(b.market))-Number(tieRefundPreference(a.market)):0);
    });
    // Verify independent over scoreboards in parallel. A dozen sequential 12s
    // dwells used to freeze the dashboard for minutes and miss later games.
    const overPreflights=new Map(),overReady=new Map(),overs=live()?opportunities.filter(c=>c.signal.strategy==='over'&&hasAsk(c.market)):[];
    for(const c of overs)overReady.set(signalKey(c),new Promise(resolve=>{c.preflightDone=resolve}));
    let cursor=0;
    const workersDone=Promise.all(Array.from({length:Math.min(20,overs.length)},async()=>{
      while(cursor<overs.length){const c=overs[cursor++];
        try{
          // Start the first independent observation during the Kalshi dwell.
          // A second independent read after that dwell catches corrected stats.
          const independentFirst=auditedOver(c.state,c.milestone,{cache:scoreboardCache,market:c.market}).catch(()=>false);
          const remaining=COMBO_WINDOW_MS-(Date.now()-c.state.observedAt);
          if(!Number.isFinite(remaining))continue;
          if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
          const latest=await liveMilestone(c.milestone.id);
          if(!latest)continue;
          latest._observed_at=new Date().toISOString();
          const state=gameState(c.milestone,latest);
          if(confirmedOver(c.state,state,c.market)&&await independentFirst&&await auditedOver(state,c.milestone,{cache:scoreboardCache,market:c.market,firstObservation:c.state}))overPreflights.set(signalKey(c),state);
        }catch(e){console.warn('Over preflight deferred:',c.market.ticker,e.message)}
        finally{c.preflightDone()}
      }
    }));
    for(const c of opportunities){let state=c.state;try{
        if(!live())continue;
        if(filled.has(signalKey(c)))continue;
        // A confirmed fill is final for this market and strategy. Check before moving
        // cash between shards, not only inside the order reservation.
        const prior=await pool.query(`SELECT status FROM trade_attempts WHERE market_ticker=$1 AND strategy=$2`,[c.market.ticker,c.signal.strategy]);
        if(prior.rows[0]?.status==='filled')continue;
        if(!hasAsk(c.market)){
          if(['check_order','reserved'].includes(prior.rows[0]?.status))await recoverPending(c.signal,state,c.event,c.market,0,0,0);
          continue;
        }
        // Refresh available cash before every order. If the account cannot afford one contract plus
        // the fee reserve, orderSize returns zero and no order is sent to Kalshi.
        const latest=await accountBalance({fresh:true});balance=Number(latest.balance);bankroll=balance+Number(latest.portfolio_value);
        // A confirmed over preflight expires quickly; never submit on a stale
        // score. Lead games still require a fresh check before the quote.
        if(c.signal.strategy==='over'&&overReady.has(signalKey(c)))await overReady.get(signalKey(c));
        let freshState=c.signal.strategy==='over'?overPreflights.get(signalKey(c)):
          gameState(c.milestone,(await liveBatch([c.milestone])).get(c.milestone.id));
        if(!freshState)continue;
        if(c.signal.strategy==='over'&&Date.now()-freshState.observedAt>10000){
          const remaining=COMBO_WINDOW_MS-(Date.now()-freshState.observedAt);
          if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
          const next=await liveMilestone(c.milestone.id);
          if(!next)continue;
          next._observed_at=new Date().toISOString();const rechecked=gameState(c.milestone,next);
          if(!confirmedOver(freshState,rechecked,c.market)||!await auditedOver(rechecked,c.milestone,{cache:scoreboardCache,market:c.market,firstObservation:freshState}))continue;
          freshState=rechecked;
        }
        if(c.signal.strategy==='lead' && /basketball/.test(state.type) &&
          (freshState.period!==state.period || !freshState.periodConsistent ||
            freshState.remainingSeconds>state.remainingSeconds))continue;
        const rawQuote=await recoverSummaryAsk((await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market);
        const quote=rawQuote&&hasAsk(rawQuote)?await executableQuote(rawQuote):null;
        if(!quote||quote.ticker!==c.market.ticker||quote.event_ticker!==c.event.event_ticker||!hasAsk(quote))continue;
        const stillQualifies=c.signal.strategy==='over'?overSignal(freshState,quote):golfSignal(freshState,quote)||leadSignal(freshState,quote)||additionalLeadSignal(freshState,quote)||tennisSignal(freshState,quote)||tableTennisSignal(freshState,quote);
        if(!stillQualifies)continue;
        if(freshState.golf&&!await verifyGolf(freshState,c.milestone,c.event))continue;
        if(tableTennisSignal(freshState,quote)&&!await verifyIndependentTableTennisLead(freshState,c.milestone))continue;
        c.signal=stillQualifies;
        c.market=quote;
        c.state=state=freshState;
        const budget=c.signal.strategy==='over'?overRemaining:Infinity;
        const wanted=executableCount(c,balance,bankroll,overRemaining);
        if(!wanted)continue;
        const shard=marketShard(c.event,c.market),localCash=shardCash(latest,shard);
        if(localCash===null){executionErrors.push(`${c.market.ticker}: Kalshi shard balance unavailable`);continue}
        if(['check_order','reserved','retrying'].includes(prior.rows[0]?.status)){
          await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,bankroll);
          continue;
        }
        if(prior.rows[0]?.status==='needs_review')continue;
        const desiredCost=estimatedCostCents(wanted,Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
        if(localCash<desiredCost&&transferPlan(latest,shard,desiredCost)){
          await ensureShardFunding(c.signal,c.event,c.market,latest,desiredCost);
          continue;
        }
        if(await submit(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,bankroll)||await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,bankroll)){
          submitted++;filled.add(signalKey(c));const before=balance;const account=await accountBalance({fresh:true});balance=Number(account.balance);bankroll=balance+Number(account.portfolio_value);
          if(c.signal.strategy==='over')overRemaining=Math.max(0,overRemaining-Math.max(0,before-balance));
        }
      }catch(e){const message=`${c.market.ticker}: ${String(e.message).slice(0,170)}`;executionErrors.push(message);console.error('Candidate execution failed:',message)}
    }
    await workersDone;
    // The first ticket uses the currently held fills. A later ticket waits for
    // two newly filled singles, then uses up to six distinct held games.
    if(live()&&account){
      const last=(await pool.query(`SELECT created_at FROM trade_attempts WHERE combo_legs IS NOT NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
      const [currentPositions,currentAccount,currentFills]=await Promise.all([
        allOpenPositions(),accountBalance({fresh:true}),pool.query(`SELECT market_ticker,event_ticker,game_id,strategy,fill_count,limit_price,created_at,updated_at,combo_legs FROM trade_attempts WHERE status='filled'`)
      ]);
      const held=new Set((currentPositions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>p.ticker));
      const singles=filledComboWindow(currentFills.rows,held,last?.created_at);
      if(singles.length>=2||opportunities.length>=2){
        const gameById=new Map(games.map(g=>[g.milestone.id,g]));
        const comboCandidates=singles.flatMap(r=>{
          const g=gameById.get(r.game_id),event=events.get(r.event_ticker),market=(event?.markets||[]).find(m=>m.ticker===r.market_ticker);
          if(!g?.state.verifiedLive||!market)return [];
          const signal=r.strategy==='over'?overSignal(g.state,market):golfSignal(g.state,market)||leadSignal(g.state,market)||additionalLeadSignal(g.state,market)||tennisSignal(g.state,market)||tableTennisSignal(g.state,market);
          return signal?[{...g,market,event,signal,state:g.state}]:[];
        });
        const group=[],seenGames=new Set(),seenEvents=new Set();
        for(const c of [...comboCandidates,...opportunities]){if(seenGames.has(c.milestone.id)||seenEvents.has(c.event.event_ticker))continue;
          group.push(c);seenGames.add(c.milestone.id);seenEvents.add(c.event.event_ticker);if(group.length===10)break}
        if(group.length>=2)try{
          const result=await executeCombo(group,currentAccount,Number(currentAccount.balance)+Number(currentAccount.portfolio_value),overRemaining,scoreboardCache);
          if(result.filled)submitted++;
        }catch(e){executionErrors.push('Combo: '+String(e.message).slice(0,180));console.error('Combo execution deferred:',e)}
      }
    }
    await pool.query('UPDATE scan_status SET last_scan=$5,last_error=$4,scanned=$1,signals=$2,orders_submitted=orders_submitted+$3 WHERE id=1',[scanned,signals,submitted,executionErrors.length?executionErrors.slice(0,2).join('; ').slice(0,250):null,scanStarted]);
    try{await syncSettlementAlerts()}catch(e){console.error('Settlement alert scan failed:',e)}
    return {scanned,signals,submitted,active:active.length,next:games.filter(g=>g.state.verifiedLive || (new Date(g.milestone.start_date).getTime()>Date.now()-3600000 && new Date(g.milestone.start_date).getTime()<Date.now()+3600000)).map(g=>g.milestone)};
  }catch(e){console.error('Scan failed:',e);await pool.query('UPDATE scan_status SET last_scan=now(),last_error=$1,scanned=$2,signals=$3 WHERE id=1',[String(e.message).slice(0,250),scanned,signals]);return {error:e.message,scanned,signals,next:ms}}
  finally{await client.query('ROLLBACK');client.release()}
}
async function refreshOpenClocks(){
  // Only the dashboard visitor requests this five-second refresh; the scanner
  // can spend longer evaluating orders without freezing the visible game clock.
  const claim=await pool.query(`UPDATE scan_status SET clock_refresh_at=clock_timestamp() WHERE id=1
    AND (clock_refresh_at IS NULL OR clock_refresh_at<now()-interval '5 seconds') RETURNING id`);
  if(!claim.rowCount)return;
  try{
    const {rows}=await pool.query(`SELECT DISTINCT g.id,g.title,g.sport,g.sport_family,g.home_team_id,g.away_team_id FROM trade_attempts a
      JOIN game_snapshots g ON g.id=a.game_id WHERE a.status='filled' AND g.status='live'
      ORDER BY g.id LIMIT 40`);
    if(!rows.length)return;
    const milestones=rows.map(g=>({id:g.id,title:g.title,type:g.sport_family,details:{league:g.sport,home_team_id:g.home_team_id,away_team_id:g.away_team_id}}));
    const data=await liveBatch(milestones);
    await Promise.all(milestones.map(async m=>{
      const item=data.get(m.id);if(!item)return;
      const s=gameState(m,item);
      const final=/^(final|finished|complete|completed|closed|ended)$/.test(s.status);
      if(!s.verifiedLive&&!final)return;
      const soccer=/soccer/.test(s.type),baseball=/baseball/.test(s.type),tennis=/tennis/.test(s.type);
      const seconds=s.verifiedLive?(soccer&&Number.isFinite(s.matchRemainingSeconds)?s.matchRemainingSeconds:
        soccer&&Number.isFinite(s.soccerMinute)&&s.soccerMinute<90?(90-s.soccerMinute)*60:
        !baseball&&!tennis&&!soccer&&Number.isFinite(s.remainingSeconds)?s.remainingSeconds:null):null;
      const label=soccer?'Regulation left':baseball?'Inning progress':tennis?'Set progress':['NCAAB','NCAAW'].includes(s.sport)?`Half ${s.period||'?'} left`:/hockey/.test(s.type)?`Period ${s.period||'?'} left`:/football|basketball/.test(s.type)?`Quarter ${s.period||'?'} left`:'Game clock';
      await pool.query(`UPDATE game_snapshots SET home=$2,away=$3,status=$4,time_left=$5,possession_side=$9,
        clock_observed_at=CASE WHEN clock_seconds IS DISTINCT FROM $6::integer OR period IS DISTINCT FROM $8::text OR status IS DISTINCT FROM $4::text
          THEN clock_timestamp() ELSE clock_observed_at END,
        clock_seconds=$6,clock_label=$7,period=$8,scanned_at=clock_timestamp()
        WHERE id=$1 AND (scanned_at<clock_timestamp() OR status='live')
          AND (status IS DISTINCT FROM 'live' OR $4::text IS DISTINCT FROM 'live' OR period IS DISTINCT FROM $8::text OR clock_seconds IS NULL OR $6::integer IS NULL OR $6::integer<=clock_seconds)`,
        [m.id,s.scoreKnown?s.home:null,s.scoreKnown?s.away:null,s.verifiedLive?'live':'final',
          gameTimeLabel(s),storedClockSeconds(seconds,s.clockRunning),s.clockRunning===false?`${label} · paused`:label,String(s.period||''),s.possessionSide]);
    }));
  }catch(e){console.warn('Dashboard clock refresh deferred:',e.message)}
}
async function state(){const [snap,stats,attempts,weatherStatus]=await Promise.all([
  pool.query(`SELECT id,title,sport,home,away,possession_side,status,time_left,signals FROM game_snapshots WHERE status IN ('live','inprogress','started') AND scanned_at>=(SELECT COALESCE(last_scan,now()-interval '1 minute') FROM scan_status WHERE id=1) ORDER BY jsonb_array_length(signals) DESC,title`),
  pool.query('SELECT * FROM scan_status WHERE id=1'),
  pool.query(`SELECT a.market_ticker,a.game_id,a.sport,a.strategy,a.reason,a.combo_legs,a.fill_count,a.limit_price,g.status AS game_status,g.title AS game_title,g.sport_family,g.possession_side,g.home AS home_score,g.away AS away_score,g.scanned_at AS score_scanned_at,g.clock_seconds,g.clock_label,g.clock_observed_at,g.time_left FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id WHERE a.status='filled' ORDER BY a.created_at DESC`),
  pool.query('SELECT * FROM weather_scan_status WHERE id=1')
]);
  let balance=null,positions=null,accountError=null,positionsError=null;
  if(configured()){
    const [balanceResult,positionsResult]=await Promise.allSettled([
      accountBalance(),allOpenPositions()
    ]);
    if(balanceResult.status==='fulfilled'){
      const value=balanceResult.value;
      if(Number.isFinite(Number(value.balance))&&Number.isFinite(Number(value.portfolio_value)))balance=value;
      else accountError='Kalshi returned an incomplete balance response';
    }else accountError=String(balanceResult.reason?.message||balanceResult.reason);
    if(positionsResult.status==='fulfilled')positions=positionsResult.value;
    else positionsError=String(positionsResult.reason?.message||positionsResult.reason);
  }else accountError='Kalshi credentials are missing from the Neon function environment';
  const open=new Set((positions?.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
  const orders=positions?attempts.rows.filter(o=>open.has(o.market_ticker)).map(o=>{
    const position=(positions.market_positions||[]).find(p=>p.ticker===o.market_ticker);
    const count=Math.min(Number(o.fill_count),Number(position?.position_fp||0));
    return {...o,position,allocated_cents:Math.ceil(count*Number(o.limit_price)*100),potential_profit_cents:netSettlementProfitCents(count,Number(o.limit_price),2)};
  }):[];
  await Promise.all(orders.map(async o=>{try{
    o.sell_quote=await currentSell(o.market_ticker);
    if(o.sell_quote)o.sell_profit_cents=estimatedSaleProfitCents(o.position,o.sell_quote,o.limit_price);
  }catch{o.sell_quote=null}delete o.position}));
  return {live:live(),exitOnly:exitOnly(),credentials:configured(),aiConfigured:Boolean(process.env.AI_API_KEY),balance,accountError,positionsError,games:snap.rows,scan:stats.rows[0],weather:weatherStatus.rows[0],orders};
}
async function settlementAlerts(since){
  const {rows}=await pool.query(`SELECT id,ticker,profit_cents,settled_time,created_at FROM settlement_alerts WHERE id>$1 AND created_at>now()-interval '2 days' ORDER BY id LIMIT 50`,[since]);
  return rows;
}
export default {async fetch(req){const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname==='/health')return json({ok:true,live:live(),exitOnly:exitOnly(),credentials:configured(),tradingSwitch:process.env.LIVE_TRADING==='true'?'on':'off',revision:'parallel-sources-golf-combos-20261029'});
  if(req.method==='GET'&&url.pathname==='/manifest.webmanifest')return response(manifest,'application/manifest+json');
  if(req.method==='GET'&&url.pathname==='/sw.js')return new Response(worker,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','service-worker-allowed':'/','x-content-type-options':'nosniff'}});
  if(req.method==='GET'&&/^\/icon-(192|512)\.png$/.test(url.pathname))return response(Buffer.from(icons[Number(url.pathname.match(/\d+/)[0])],'base64'),'image/png');
  if(req.method==='POST'&&url.pathname==='/tick'){
    if(!req.headers.get('x-neon-trigger-invocation-id'))return json({error:'Forbidden'},403);
    const weatherJob=scanWeatherMarkets({kalshi,nws,onVerified:executeVerifiedWeather}).then(async stats=>{
      await pool.query(`UPDATE weather_scan_status SET last_scan=now(),series=$1,events=$2,eligible=$3,verified=$4,failures=$5 WHERE id=1`,[stats.series,stats.events,stats.eligible,stats.verified,stats.failures]);
    }).catch(e=>console.warn('Weather discovery deferred:',e.message));
    // Neon cron has minute resolution. Short invocations keep the three-second loop alive
    // without relying on one function instance surviving for a full quarter hour.
    const now=Date.now();const until=Math.min(now+55000,(Math.floor(now/60000)+1)*60000-2000);let cached=null,cycles=0,last={};
    while(Date.now()<until){const begun=Date.now();last=await scan(cached);cycles++;
      if(last.next)cached=last.next;if(last.error && !/Kalshi 429 /.test(last.error) || !last.error && !last.active)break;
      const pause=Math.max(0,7000-(Date.now()-begun));if(Date.now()+pause>=until)break;
      await new Promise(resolve=>setTimeout(resolve,pause));
    }
    await weatherJob;
    const {next,...summary}=last;return json({...summary,cycles});
  }
  if(req.method==='GET'&&url.pathname==='/login')return dashboardAuth(req)?Response.redirect(new URL('/',url),303):response(loginPage(),'text/html; charset=utf-8');
  if(req.method==='POST'&&url.pathname==='/login'){
    const origin=req.headers.get('origin');
    if((origin&&origin!==url.origin)||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return json({error:'Forbidden'},403);
    const raw=await req.text();if(raw.length>512)return json({error:'Invalid sign-in'},400);
    const form=new URLSearchParams(raw);
    if(!checkCredentials(form.get('username'),form.get('password'),process.env.DASHBOARD_PASSWORD))return new Response(loginPage(true),{status:401,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
    return new Response(null,{status:303,headers:{location:'/', 'set-cookie':sessionCookie(process.env.DASHBOARD_PASSWORD,Date.now(),url.protocol==='https:'),'cache-control':'no-store'}});
  }
  if(!dashboardAuth(req))return ['/', '/history'].includes(url.pathname)?new Response(null,{status:303,headers:{location:'/login','cache-control':'no-store'}}):json({error:'Sign in required'},401);
  try{
    if(req.method==='POST'&&url.pathname==='/api/sell'){
      if(req.headers.get('origin')!==url.origin||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Forbidden'},403);
      const raw=await req.text();if(raw.length>512)return json({error:'Invalid sale'},400);
      return await manualSell(JSON.parse(raw));
    }
    if(req.method==='GET'&&url.pathname==='/api/push-key')return json({key:pushIdentity().publicBase64});
    if(req.method==='GET'&&url.pathname==='/api/alerts'){
      const since=Number(url.searchParams.get('since'))||0;
      if(!Number.isFinite(since)||since<0)return json({error:'Invalid cursor'},400);
      return json({alerts:await settlementAlerts(since)});
    }
    if(req.method==='POST'&&url.pathname==='/api/push-subscription'){
      if(req.headers.get('origin')!==url.origin||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Forbidden'},403);
      const raw=await req.text();if(raw.length>4096)return json({error:'Subscription too large'},413);
      let subscription;try{subscription=validateSubscription(JSON.parse(raw))}catch{return json({error:'Invalid subscription'},400)}
      await pool.query('INSERT INTO push_subscriptions(endpoint,subscription) VALUES($1,$2) ON CONFLICT(endpoint) DO UPDATE SET subscription=EXCLUDED.subscription',[subscription.endpoint,JSON.stringify(subscription)]);
      return json({ok:true});
    }
    if(req.method==='DELETE'&&url.pathname==='/api/push-subscription'){
      if(req.headers.get('origin')!==url.origin||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Forbidden'},403);
      const raw=await req.text();if(raw.length>4096)return json({error:'Subscription too large'},413);
      let subscription;try{subscription=validateSubscription(JSON.parse(raw))}catch{return json({error:'Invalid subscription'},400)}
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[subscription.endpoint]);return json({ok:true});
    }
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const since=Number(url.searchParams.get('since'))||0;
      if(!Number.isFinite(since)||since<0)return json({error:'Invalid cursor'},400);
      await refreshOpenClocks();
      const [snapshot,alerts]=await Promise.all([state(),settlementAlerts(since).catch(e=>{console.error('Dashboard alerts unavailable:',e);return null})]);
      return json({...snapshot,alerts});
    }
    if(req.method==='GET'&&url.pathname==='/api/history'){
      const beforeTime=url.searchParams.get('before_time'),beforeId=url.searchParams.get('before_id');
      if(Boolean(beforeTime)!==Boolean(beforeId)||beforeTime&&(!Number.isFinite(new Date(beforeTime).getTime())||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(beforeId)))return json({error:'Invalid history cursor'},400);
      const {rows}=await pool.query(`SELECT id,sport,teams,occurred_at,profit_cents FROM trade_history
        WHERE ($1::timestamptz IS NULL OR (occurred_at,id)<($1::timestamptz,$2::uuid))
        ORDER BY occurred_at DESC,id DESC LIMIT 51`,[beforeTime||null,beforeId||null]);
      const history=rows.slice(0,50),last=history.at(-1);
      return json({history:history.map(({sport,teams,occurred_at,profit_cents})=>({sport,teams,occurred_at,profit_cents})),next:rows.length>50?{before_time:last.occurred_at,before_id:last.id}:null});
    }
    if(req.method==='GET'&&url.pathname==='/history')return new Response(historyPage,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
    if(req.method==='GET'&&url.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}})
  }catch(e){console.error(e);return json({error:'Service unavailable'},503)}
  return json({error:'Not found'},404);
}};
