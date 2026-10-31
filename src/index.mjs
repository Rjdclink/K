import { golfSignal, verifyGolf } from './golf.mjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { page } from './ui.mjs';
import { historyPage } from './history_ui.mjs';
import { completedTrade, manualSaleFill, reconcileManualSaleFills } from './history.mjs';
import { gameState, overSignal, confirmedOver, kalshiOnlyOver, kalshiOnlyLead, confirmedExternalLead, leadSignal, confirmedSoccerOneGoalClock, confirmedDrawClock, soccerOneGoalWindowOpen, stableSoccerLeadFraction, externallyVerifiedEarlySoccerLead, additionalLeadSignal, cricketLeadSignal, drawSignal, earlyLeadSignal, tennisSignal, tableTennisSignal, orderSize, estimatedCostCents, profitableCount, minimumProfitCents, netSettlementProfitCents, comeback, KALSHI_ONLY_FRACTION } from './strategy.mjs';
import { reviewMiss } from './ai.mjs';
import { kalshiSignature } from './auth.mjs';
import { marketShard, shardCash, transferPlan, comboShardBudget } from './funding.mjs';
import { icons } from './icons.mjs';
import { manifest, worker } from './pwa.mjs';
import { vapidIdentity, validateSubscription, deliverPush } from './push.mjs';
import { favorableSettlement } from './settlements.mjs';
import { authorized, checkCredentials, sessionCookie, loginPage } from './dashboard_auth.mjs';
import { discoverCurrentMilestones, eligibleForMarkets, linkedEventTickers, gameTimeLabel, storedClockSeconds, mapBatches } from './discovery.mjs';
import { tieRefundPreference } from './settlement_preference.mjs';
import { verifyIndependentOverDecision, verifyIndependentTableTennisLeadDecision, verifyIndependentTableTennisMatch } from './score_verification.mjs';
import { verificationStatus } from './verification_status.mjs';
import { COMBO_ATTEMPT_MS, VERIFY_DWELL_MS, COMBO_RFQ_PLANS, comboAllocation, comboLegAllocation, comboAllowedCents, comboRfqTargetCents, remainingVerifiedComboCents, availableComboFills, compatibleComboGroups, plannedComboGroups, comboPairDiagnostics, comboLegs, filledComboWindow, heldComboLeg, quoteForYes, collectionsForEvents, selectedComboMarkets, liveComboMarket } from './combos.mjs';
import { estimatedSaleProfitCents, halfPotentialProfitExitEligible, oneAndHalfExitEligible, profitTargetAllowed, overCorrectionAffects, correctionExitTargets } from './positions.mjs';
import { remainingVerifiedOverCents, upgradeEligible } from './upgrades.mjs';
import { weatherContract } from './weather.mjs';
import { scanWeatherMarkets } from './weather_scanner.mjs';
import { sellQuote } from './sell.mjs';
import { yesDepthAtAsk, bestYesAsk, bestAsksForTickers } from './orderbook.mjs';
import { filledOrderGateCount } from './entry_floor.mjs';
import { valueCandidate } from './value_scan.mjs';

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
const kalshiRateLimit=async(method,backoffMs=0)=>{
  const kind=method==='GET'?'read':'write';
  // Leave headroom for endpoints with non-default token costs and other
  // clients sharing the account's read bucket.
  const spacing=method==='GET'?250:150;
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
const kalshiBackoff=async(ms)=>{
  const delay=Math.min(60000,Math.max(1000,ms));
  await pool.query(`UPDATE kalshi_rate_limits SET next_at=GREATEST(next_at,clock_timestamp()+($1 * interval '1 millisecond')) WHERE kind='read'`,[delay]);
};
const retryDelay=(header,attempt)=>{const seconds=Number(header);const date=Date.parse(header||'');return Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):500*2**attempt};
async function kalshi(path,opts={}){
  const method=opts.method||'GET';const headers={'accept':'application/json'};
  if(opts.body)headers['content-type']='application/json';
  for(let attempt=0;;attempt++){
    await kalshiRateLimit(method);
    if(opts.auth){const {key,privateKey}=credentials();if(!key||!privateKey)throw Error('Kalshi credentials unavailable');const timestamp=String(Date.now());const unsignedPath='/trade-api/v2'+path.split('?')[0];const signature=kalshiSignature(privateKey,timestamp,method,unsignedPath);Object.assign(headers,{'KALSHI-ACCESS-KEY':key,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature})}
    const response=await fetch(API+path,{method,headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(12000)});
    const data=await response.json().catch(()=>({}));
    if(response.status===429 && method==='GET'){await kalshiBackoff(retryDelay(response.headers.get('retry-after'),attempt));if(attempt<4)continue}
    if(!response.ok){const detail=data.message||data.error?.message||data.error?.code||data.error||data.code||'request failed';const extra=data.details||data.error?.details;throw Error(`Kalshi ${response.status} ${method} ${path.split('?')[0]}: ${String(typeof detail==='object'?JSON.stringify(detail):detail).slice(0,140)}${extra?' details='+JSON.stringify(extra).slice(0,400):''}`)}
    return data;
  }
}
// The balance endpoint's Basic tier bucket is shared by every function instance.
// Serialize refreshes through Postgres and reuse a recent verified account snapshot.
let balanceQueue=Promise.resolve();
let candidateTableReady;
function candidateTable(){return candidateTableReady??=pool.query(`CREATE TABLE IF NOT EXISTS candidate_windows (market_ticker text NOT NULL, strategy text NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(market_ticker,strategy))`).catch(e=>{candidateTableReady=null;throw e})}
let scanStatusReady;
function ensureScanStatus(){return scanStatusReady??=pool.query('ALTER TABLE scan_status ADD COLUMN IF NOT EXISTS discovered integer NOT NULL DEFAULT 0').catch(e=>{scanStatusReady=null;throw e})}
let scoreTimeReady;
function ensureScoreTime(){return scoreTimeReady??=pool.query('ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS score_observed_at timestamptz').catch(e=>{scoreTimeReady=null;throw e})}
let valueScanReady;
function ensureValueScan(){return valueScanReady??=Promise.all([
  pool.query(`ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS value_signals jsonb NOT NULL DEFAULT '[]'::jsonb`),
  pool.query(`CREATE TABLE IF NOT EXISTS value_scan_observations (
    observed_at timestamptz NOT NULL,game_id text NOT NULL,market_ticker text NOT NULL,
    role text NOT NULL,ask numeric NOT NULL,ask_size numeric NOT NULL,
    game_state jsonb NOT NULL,market_rules text NOT NULL,
    PRIMARY KEY(observed_at,market_ticker))`)
]).catch(e=>{valueScanReady=null;throw e})}
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
let upgradesReady;
function upgradeTables(){return upgradesReady??=Promise.all([
  pool.query(`CREATE TABLE IF NOT EXISTS position_upgrades (market_ticker text PRIMARY KEY,id uuid NOT NULL UNIQUE,original_id uuid NOT NULL,verification_id uuid NOT NULL,status text NOT NULL,count numeric(12,2) NOT NULL,limit_price numeric NOT NULL,available_cents integer NOT NULL,order_id text,fill_count numeric NOT NULL DEFAULT 0,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`),
  pool.query(`CREATE TABLE IF NOT EXISTS robust_over_upgrades (market_ticker text PRIMARY KEY,id uuid NOT NULL UNIQUE,original_id uuid NOT NULL,verification_id uuid NOT NULL,status text NOT NULL,count numeric(12,2) NOT NULL,limit_price numeric NOT NULL,available_cents integer NOT NULL,order_id text,fill_count numeric NOT NULL DEFAULT 0,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`),
  pool.query(`CREATE TABLE IF NOT EXISTS fallback_verifications (market_ticker text PRIMARY KEY,original_id uuid NOT NULL,verification_id uuid NOT NULL,first_verified_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz NOT NULL DEFAULT now())`),
  pool.query(`CREATE TABLE IF NOT EXISTS combo_upgrades (market_ticker text PRIMARY KEY,original_id uuid NOT NULL,verification_ids jsonb NOT NULL,status text NOT NULL,rfq_id text NOT NULL,quote_id text NOT NULL,order_id text,fill_count numeric NOT NULL DEFAULT 0,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`)
]).catch(e=>{upgradesReady=null;throw e})}
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
  const decision=await verifyIndependentOverDecision(game,milestone,{...options,cache:undefined,fetcher});
  const passed=decision===true;
  await auditTable();const id=randomUUID();
  await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,$3,$4)',[id,options.market?.ticker||'',passed,JSON.stringify({game,milestone,observations,firstObservation:options.firstObservation,independentUnavailable:decision===null})]);
  if(passed)game.verificationId=id;
  return options.allowUnavailable?decision:passed;
}
async function auditKalshiOnlyOver(first,second,market,milestone){
  if(!kalshiOnlyOver(first,second,market))return false;
  await auditTable();const id=randomUUID();
  await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',
    [id,market.ticker,JSON.stringify({mode:'kalshi_only_crossed_over',first,second,milestoneId:milestone.id,dwellMs:second.observedAt-first.observedAt,allocation:KALSHI_ONLY_FRACTION})]);
  second.verificationId=id;
  return true;
}
async function auditKalshiOnlyLead(first,second,market,milestone){
  if(!kalshiOnlyLead(first,second,market))return false;
  const oneGoalSoccer=/soccer/.test(second.type)&&Math.abs(second.home-second.away)===1;
  const allocation=oneGoalSoccer?stableSoccerLeadFraction(first,second,leadSignal(second,market)):
    tennisSignal(second,market)?.fraction??cricketLeadSignal(second,market)?.fraction??drawSignal(second,market)?.fraction??earlyLeadSignal(second,market)?.fraction??KALSHI_ONLY_FRACTION;
  await auditTable();const id=randomUUID();
  await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',
    [id,market.ticker,JSON.stringify({mode:'kalshi_only_commanding_lead',first,second,milestoneId:milestone.id,dwellMs:second.observedAt-first.observedAt,allocation})]);
  second.verificationId=id;
  return true;
}
async function currentSell(ticker,positionsOverride=null,withMarket=false){
  const [positions,market,book]=await Promise.all([positionsOverride||allOpenPositions(),kalshi('/markets/'+encodeURIComponent(ticker)),kalshi('/markets/'+encodeURIComponent(ticker)+'/orderbook')]);
  const held=Number(positions.market_positions?.find(p=>p.ticker===ticker)?.position_fp||0);
  const quote=sellQuote(book.orderbook_fp,held,market.market?.fractional_trading_enabled===false);
  return withMarket?{quote,market:market.market}:quote;
}
async function manualSell(body){
  if(!/^[A-Z0-9-]{1,180}$/.test(body.ticker||'')||!Number.isFinite(body.price)||body.price<=0||body.price>=1||!/^[0-9a-f-]{36}$/.test(body.id||''))return json({error:'Invalid sale'},400);
  await pool.query(`CREATE TABLE IF NOT EXISTS manual_sales(id uuid PRIMARY KEY,ticker text NOT NULL,status text NOT NULL,result jsonb,created_at timestamptz DEFAULT now())`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['sell:'+body.ticker]);
    const over=await client.query("SELECT 1 FROM trade_attempts WHERE market_ticker=$1 AND status='filled' AND strategy='over' LIMIT 1",[body.ticker]);
    if(over.rowCount){await client.query('ROLLBACK');return json({error:'Manual selling is disabled for OVER tickets'},403)}
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
  await upgradeTables();
  const {rows:pending}=await pool.query(`SELECT a.id,a.market_ticker,a.sport,a.order_id,a.fill_count,a.created_at,a.combo_legs,
      u.order_id AS upgrade_order_id,u.fill_count AS upgrade_fill_count,
      ru.order_id AS robust_upgrade_order_id,ru.fill_count AS robust_upgrade_fill_count,
      cu.order_id AS combo_upgrade_order_id,cu.fill_count AS combo_upgrade_fill_count,
      (SELECT SUM(e.filled_count) FROM exit_attempts e WHERE e.market_ticker=a.market_ticker AND e.filled_count>0) AS expected_sold,
      g.sport_family,COALESCE(g.title,'Sports game') AS teams
    FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id
      LEFT JOIN position_upgrades u ON u.original_id=a.id AND u.status='filled'
      LEFT JOIN robust_over_upgrades ru ON ru.original_id=a.id AND ru.status='filled'
      LEFT JOIN combo_upgrades cu ON cu.original_id=a.id AND cu.status='filled'
    WHERE a.created_at>=$1 AND a.status='filled' AND
      (NOT EXISTS (SELECT 1 FROM trade_history h WHERE h.id=a.id) OR
       EXISTS (SELECT 1 FROM exit_attempts e WHERE e.market_ticker=a.market_ticker AND e.filled_count>0))
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
  // The fills API accepts one ticker, not a comma-joined list. Query each
  // unfinished or exited trade separately so its buy and sale both reconcile.
  const {rows:[saleTable]}=await pool.query("SELECT to_regclass('manual_sales') AS name");
  const manualSales=saleTable?.name?(await pool.query("SELECT ticker,result,created_at FROM manual_sales WHERE status='complete' AND ticker=ANY($1::text[])",[pending.map(item=>item.market_ticker)])).rows:[];
  const manualByTicker=new Map();
  for(const sale of manualSales){
    const fill=manualSaleFill(sale);
    if(!fill)continue;
    const list=manualByTicker.get(sale.ticker)||[];
    list.push(fill);
    manualByTicker.set(sale.ticker,list);
  }
  const tickers=[...new Set(pending.map(item=>item.market_ticker))];
  tickers.sort((a,b)=>Number(manualByTicker.has(b))-Number(manualByTicker.has(a)));
  for(const ticker of tickers){
    const allFills=[];
    let cursor='',complete=false;
    for(let pageNumber=0;pageNumber<10;pageNumber++){
      const query=new URLSearchParams({ticker,min_ts:String(Math.floor(new Date(config.started_at).getTime()/1000)),limit:'1000'});
      if(cursor)query.set('cursor',cursor);
      const result=await kalshi('/portfolio/fills?'+query,{auth:true});
      allFills.push(...result.fills||[]);cursor=result.cursor||'';
      if(!cursor){complete=true;break}
    }
    if(!complete)throw Error('Trade history fills exceed pagination safety limit');
    const manualFills=manualByTicker.get(ticker)||[];
    const known=new Set(allFills.map(fill=>fill.order_id));
    const fills=reconcileManualSaleFills(allFills,manualFills).concat(manualFills.filter(fill=>!known.has(fill.order_id)));
    for(const entry of pending.filter(item=>item.market_ticker===ticker)){
      const completed=completedTrade(entry,fills,settled.get(ticker));
      if(!completed)continue;
      const sport=([['basketball','Basketball'],['hockey','Hockey'],['football','Football'],['baseball','Baseball'],['soccer','Soccer'],['tennis','Tennis']]
        .find(([family])=>String(entry.sport_family||'').includes(family))||[])[1]||entry.sport;
      await pool.query(`INSERT INTO trade_history(id,market_ticker,sport,teams,occurred_at,profit_cents,outcome)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET
          occurred_at=EXCLUDED.occurred_at,profit_cents=EXCLUDED.profit_cents,outcome=EXCLUDED.outcome`,
        [entry.id,entry.market_ticker,entry.combo_legs?.length?`${entry.combo_legs.length}-pick combo`:sport,
          entry.combo_legs?.length?entry.combo_legs.map(l=>l.title).join(' / '):entry.teams,completed.occurredAt,completed.profitCents,completed.outcome]);
    }
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
// Serialize final buy decisions across the scan's parallel singles, weather and
// combo jobs. Count the same filled, open positions shown on the dashboard;
// recent in-flight attempts occupy a slot until Kalshi reports their fill.
async function withEntryProfitFloor({ticker,count,price,fees,strategy,bankroll},send){
  for(;;){
    const client=await pool.connect();let busy=false;
    try{
      await client.query('BEGIN');
      const {rows:[lock]}=await client.query('SELECT pg_try_advisory_xact_lock(83027546) AS acquired');
      if(!lock.acquired){busy=true;await client.query('ROLLBACK')}
      else{
        const positions=await allOpenPositions();
        const {rows}=await client.query(`SELECT market_ticker,status FROM trade_attempts
          WHERE status='filled' OR status IN ('reserved','check_order','retrying','combo_pending')
            AND updated_at>now()-interval '2 minutes'`);
        const required=minimumProfitCents(strategy,bankroll,'',NaN,filledOrderGateCount(positions,rows,ticker));
        if(netSettlementProfitCents(count,price,fees)<required){await client.query('COMMIT');return null}
        const result=await send();
        await client.query('COMMIT');
        return result;
      }
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
    finally{client.release()}
    if(busy)await new Promise(resolve=>setTimeout(resolve,100));
  }
}
async function milestones(){
  const started=Date.now(),found=await discoverCurrentMilestones(kalshi);
  console.info('Sports discovery:',JSON.stringify({milestones:found.length,elapsedMs:Date.now()-started}));
  return found;
}
async function liveBatch(ms){
  const started=Date.now();
  const map=new Map(),groups=[];
  for(let i=0;i<ms.length;i+=20)groups.push(ms.slice(i,i+20));
  const results=await mapBatches(groups,12,async group=>{const q=new URLSearchParams();group.forEach(m=>q.append('milestone_ids',m.id));q.set('include_player_stats','true');
    let list=[];try{list=(await kalshi('/live_data/batch?'+q)).live_datas||[]}catch(e){
      if(!/^Kalshi (400|404|405) /.test(String(e.message)))throw e;
      console.warn('Live batch unsupported; using bounded individual requests:',e.message);
      for(const m of group){try{let result;try{result=await kalshi('/live_data/milestone/'+encodeURIComponent(m.id)+'?include_player_stats=true')}catch(error){if(!/^Kalshi (400|404) /.test(String(error.message)))throw error;result=await kalshi('/live_data/milestone/'+encodeURIComponent(m.id))}if(result.live_data)list.push(result.live_data)}catch(error){if(/Kalshi 429 /.test(String(error.message)))throw error}}
    }
    return {list,observedAt:new Date().toISOString()};});
  results.forEach(({list,observedAt})=>list.forEach(d=>map.set(d.milestone_id,{...d,_observed_at:observedAt})));
  if(ms.length>100)console.info('Live batch:',JSON.stringify({milestones:ms.length,groups:groups.length,returned:map.size,elapsedMs:Date.now()-started}));
  return map;
}
async function liveMilestone(id){
  const path='/live_data/milestone/'+encodeURIComponent(id);
  try{return (await kalshi(path+'?include_player_stats=true')).live_data}
  catch(e){if(!/^Kalshi (400|404) /.test(String(e.message)))throw e;return (await kalshi(path)).live_data}
}
const eventCache=new Map();
async function marketMap(tickers){
  const map=new Map();const list=[...new Set(tickers)].filter(Boolean).filter(t=>{const cached=eventCache.get(t);if(cached&&Date.now()-cached.at<7000){map.set(t,cached.event);return false}return true});
  for(let i=0;i<list.length;i+=70){const chunks=[list.slice(i,i+35),list.slice(i+35,i+70)].filter(c=>c.length);
    const results=await Promise.all(chunks.map(chunk=>kalshi('/events?'+new URLSearchParams({tickers:chunk.join(','),with_nested_markets:'true',limit:'200',status:'open'}))));
    for(const result of results)for(const e of result.events||[]){map.set(e.event_ticker,e);eventCache.set(e.event_ticker,{event:e,at:Date.now()})}
  }for(const [ticker,item] of eventCache)if(Date.now()-item.at>30000)eventCache.delete(ticker);return map;
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
async function reportVerifiedGate(game,ticker,reason,clearAsk=false){
  console.info('Verified candidate blocked at final gate:',JSON.stringify({ticker,reason}));
  await pool.query(`UPDATE game_snapshots AS g SET signals=(
    SELECT jsonb_agg(CASE WHEN s->>'ticker'=$2 THEN
      CASE WHEN $6::boolean THEN jsonb_set(jsonb_set(s,'{execution}',to_jsonb($3::text)),'{ask_size}',to_jsonb('0.00'::text))
        ELSE jsonb_set(s,'{execution}',to_jsonb($3::text)) END
      ELSE s END) FROM jsonb_array_elements(g.signals) s)
    WHERE g.id=$1 AND g.home=$4 AND g.away=$5 AND
      g.signals @> jsonb_build_array(jsonb_build_object('ticker',$2::text))`,
  [game.id,ticker,reason,game.home,game.away,clearAsk]);
}
const askProbe=new Map();
async function recoverSummaryAsk(market,{fresh=false}={}){
  if(hasAsk(market))return market;
  const cached=fresh?null:askProbe.get(market.ticker);
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
function executableCount(c,balance,bankroll){
  const fees=feeReserve(c.event,c.market),price=Number(c.market.yes_ask_dollars);
  const count=contractCount(balance,c.market,c.signal.fraction,bankroll,Infinity,fees);
  return profitableCount(count,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds);
}
const signalKey=c=>`${c.market.ticker}:${c.signal.strategy}`;
function signalExecution(c,filled,account,balance,bankroll){
  if(filled.has(signalKey(c)))return 'Already filled';
  if(!hasAsk(c.market))return 'No ask liquidity';
  if(!account)return 'Trading paused';
  const price=Number(c.market.yes_ask_dollars),fees=feeReserve(c.event,c.market);
  if(price>Number(process.env.MAX_YES_PRICE||1))return 'Ask above maximum YES price';
  const spendable=balance;
  const raw=contractCount(spendable,c.market,c.signal.fraction,bankroll,Infinity,fees);
  if(!raw)return 'Insufficient available cash for this trade';
  if(!profitableCount(raw,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds)){
    // Fractional contracts and fee rounding can still leave zero net cents.
    if(['over','lead'].includes(c.signal.strategy)&&netSettlementProfitCents(raw,price,fees)<1)
      return 'No positive net profit after fees';
    return 'Below minimum net profit after fees';
  }
  const local=shardCash(account,marketShard(c.event,c.market));
  if(local===null)return 'Shard balance unavailable';
  if(local<estimatedCostCents(raw,price,fees)){
    if(transferPlan(account,marketShard(c.event,c.market),estimatedCostCents(raw,price,fees)))return 'Verification pending; shard transfer needed if confirmed';
    const localCount=contractCount(Math.min(spendable,local),c.market,c.signal.fraction,bankroll,Infinity,fees);
    if(!profitableCount(localCount,price,fees,c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds))return 'Insufficient shard cash';
  }
  return c.signal.strategy==='over'?'Awaiting score verification':'Eligible for final verification';
}
async function ensureShardFunding(signal,event,market,account,desiredCents,sourceFloorCents=0){
  const destination=marketShard(event,market);
  const plan=transferPlan(account,destination,desiredCents,sourceFloorCents);
  if(!plan)return false;
  const {rows:[pending]}=await pool.query(`SELECT * FROM funding_transfers WHERE market_ticker=$1 AND strategy=$2 AND status IN ('pending','uncertain') ORDER BY created_at DESC LIMIT 1`,[market.ticker,signal.strategy]);
  // Funding belongs to the destination shard, not a market. Do not queue
  // competing transfers against the same source cash while one is settling.
  if(!pending){const inFlight=await pool.query(`SELECT id FROM funding_transfers WHERE status IN ('pending','uncertain') AND (destination_shard=$1 OR source_shard=$2) LIMIT 1`,[destination,plan.sourceShard]);if(inFlight.rowCount)return false}
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
async function stageCashAcrossShards(account,bankroll){
  // Keep a starter amount in every exchange shard before games begin. This is
  // ordinary available cash, never a trading reservation or combo reserve.
  const shards=[...new Set((account.balance_breakdown||[]).map(b=>Number(b.exchange_index)).filter(Number.isInteger))];
  if(!shards.length)return;
  const target=Math.min(Math.floor(bankroll*.15),Math.floor(Number(account.balance)/shards.length));
  if(target<100)return;
  const underfunded=shards.filter(shard=>(shardCash(account,shard)??0)<target)
    .sort((a,b)=>(shardCash(account,a)??0)-(shardCash(account,b)??0));
  for(const shard of underfunded){
    if(!transferPlan(account,shard,target,target))continue;
    const marker={exchange_index:shard,ticker:`STAGING-SHARD-${shard}`};
    await ensureShardFunding({strategy:'staging'},marker,marker,account,target,target);
    break; // One transfer per cycle; the next cycle uses a fresh balance.
  }
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
  if(/Kalshi-only/i.test(signal.reason||'')){
    // A provisional position consumes its entire allowance for this game.
    // Filled historical trades count only while their market is still held.
    const positions=await allOpenPositions();
    const held=(positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>p.ticker);
    const existing=await pool.query(`SELECT 1 FROM trade_attempts WHERE game_id=$1
      AND status IN ('filled','reserved','check_order','retrying') AND reason ILIKE '%Kalshi-only%'
      AND (status<>'filled' OR market_ticker=ANY($2::text[])) LIMIT 1`,[game.id,held]);
    if(existing.rowCount)return false;
  }
  const active=await pool.query(`SELECT 1 FROM trade_attempts WHERE market_ticker=$1 AND status IN ('filled','reserved','check_order','retrying','combo_pending') LIMIT 1`,[market.ticker]);
  if(active.rowCount)return false;
  if(!soccerOneGoalWindowOpen(game))return false;
  const id=await reserve(signal,game,event,market,count,price,balance);if(!id)return false;
  await pool.query(`CREATE TABLE IF NOT EXISTS order_verifications(order_id uuid PRIMARY KEY,verification_id uuid NOT NULL,created_at timestamptz DEFAULT now())`);
  if(game.verificationId)await pool.query('INSERT INTO order_verifications(order_id,verification_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,game.verificationId]);
  if(!soccerOneGoalWindowOpen(game)){
    await pool.query(`UPDATE trade_attempts SET status='unfilled',error='Final whistle window elapsed before submission',updated_at=now() WHERE id=$1`,[id]);
    return false;
  }
  try{
    // A partial IOC fill can be below the minimum net profit. Require the
    // entire quantity at the limit price or no entry at all.
    const result=await withEntryProfitFloor({ticker:market.ticker,count,price,fees:feeReserve(event,market),strategy:signal.strategy,bankroll},
      ()=>kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:market.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}}));
    if(!result){await pool.query(`UPDATE trade_attempts SET status='unfilled',error='Below filled-order net profit floor',updated_at=now() WHERE id=$1`,[id]);return false}
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
    !profitableCount(Number(row.count),Number(row.limit_price),feeReserve(event,market),signal.strategy,availableCents,game.type,game.remainingSeconds)||
    !soccerOneGoalWindowOpen(game))return false;
  const claim=await pool.query(`UPDATE trade_attempts SET retries=1,status='retrying',ai_review=$2,updated_at=now() WHERE id=$1 AND status IN ('check_order','reserved') AND retries=0 RETURNING id`,[row.id,review.reason]);
  if(!claim.rowCount)return false;
  if(!soccerOneGoalWindowOpen(game)){
    await pool.query(`UPDATE trade_attempts SET status='unfilled',error='Final whistle window elapsed before retry',updated_at=now() WHERE id=$1`,[row.id]);
    return false;
  }
  try{const result=await withEntryProfitFloor({ticker:row.market_ticker,count:Number(row.count),price:Number(row.limit_price),fees:feeReserve(event,market),strategy:signal.strategy,bankroll},
    ()=>kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:row.market_ticker,client_order_id:row.id,side:'bid',count:Number(row.count).toFixed(2),price:Number(row.limit_price).toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}}));
    if(!result){await pool.query(`UPDATE trade_attempts SET status='check_order',retries=0,error='Below filled-order net profit floor',updated_at=now() WHERE id=$1`,[row.id]);return false}
    const filled=Number(result.fill_count_fp??result.fill_count??result.order?.fill_count_fp??result.order?.fill_count??0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',result.order_id||result.order?.order_id||null,filled]);return filled>0
  }catch(e){await pool.query(`UPDATE trade_attempts SET status='check_order',error=$2,updated_at=now() WHERE id=$1`,[row.id,'Recovery response uncertain: '+String(e.message).slice(0,200)]);return false}
}
async function reconcileUpgrade(row,robust=false){
  if(!row||!['reserved','check_order'].includes(row.status))return row;
  try{
    let cursor='';
    for(let page=0;page<5;page++){
      const query=new URLSearchParams({ticker:row.market_ticker,min_ts:String(Math.floor(new Date(row.created_at).getTime()/1000)-60),limit:'1000'});
      if(cursor)query.set('cursor',cursor);
      const orders=await kalshi('/portfolio/orders?'+query,{auth:true});
      const match=(orders.orders||[]).find(o=>o.client_order_id===row.id);
      if(match){
        const filled=Number(match.fill_count_fp??match.fill_count??0);
        await pool.query(`UPDATE ${robust?'robust_over_upgrades':'position_upgrades'} SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE market_ticker=$1`,
          [row.market_ticker,filled>0?'filled':'unfilled',match.order_id||null,filled]);
        if(filled>0)await invalidateBalance();
        return {...row,status:filled>0?'filled':'unfilled'};
      }
      cursor=orders.cursor||'';if(!cursor)break;
    }
  }catch(e){console.warn('Upgrade reconciliation deferred:',row.market_ticker,e.message)}
  // An absent order is not proof that a prior submission never executed.
  return row;
}
async function upgradeHeldOver(c,preflight,original,scoreboardCache){
  if(!preflight||preflight.kalshiOnly||!preflight.state?.verificationId)return {verified:false,filled:false};
  let state=preflight.state;
  if(Date.now()-state.observedAt>10000){
    const next=await liveMilestone(c.milestone.id);if(!next)return {verified:false,filled:false};
    next._observed_at=new Date().toISOString();const checked=gameState(c.milestone,next);
    if(!confirmedOver(state,checked,c.market,0)||await auditedOver(checked,c.milestone,{market:c.market,firstObservation:state,allowUnavailable:true})!==true)return {verified:false,filled:false};
    state=checked;
  }
  const current=(await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market;
  const verifiedSignal=current?overSignal(state,current):null;
  if(!current||current.ticker!==original.market_ticker||current.event_ticker!==original.event_ticker||
    current.rules_primary!==c.market.rules_primary||current.floor_strike!==c.market.floor_strike||
    current.cap_strike!==c.market.cap_strike||current.close_time!==c.market.close_time||
    JSON.stringify(current.custom_strike||{})!==JSON.stringify(c.market.custom_strike||{})||
    !verifiedSignal||![.30,.40].includes(verifiedSignal.fraction))return {verified:false,filled:false};
  await upgradeTables();
  if(/Kalshi-only/i.test(original.reason||''))await pool.query(`INSERT INTO fallback_verifications(market_ticker,original_id,verification_id,verified_at) VALUES($1,$2,$3,now())
    ON CONFLICT(market_ticker) DO UPDATE SET original_id=EXCLUDED.original_id,verification_id=EXCLUDED.verification_id,
      first_verified_at=CASE WHEN fallback_verifications.original_id=EXCLUDED.original_id THEN fallback_verifications.first_verified_at ELSE now() END,verified_at=now()`,
  [current.ticker,original.id,state.verificationId]);
  const robust=verifiedSignal.fraction===.40,upgradeTable=robust?'robust_over_upgrades':'position_upgrades';
  const otherTable=robust?'position_upgrades':'robust_over_upgrades';
  let {rows:[other]}=await pool.query(`SELECT * FROM ${otherTable} WHERE market_ticker=$1`,[current.ticker]);
  if(other&&['reserved','check_order'].includes(other.status))other=await reconcileUpgrade(other,!robust);
  if((other&&['reserved','check_order'].includes(other.status))||(!robust&&other?.status==='filled'))return {verified:true,filled:false};
  let {rows:[prior]}=await pool.query(`SELECT * FROM ${upgradeTable} WHERE market_ticker=$1`,[current.ticker]);
  if(prior&&['reserved','check_order'].includes(prior.status))prior=await reconcileUpgrade(prior,robust);
  if(prior&&!['unfilled','rejected'].includes(prior.status))return {verified:true,filled:false};
  const raw=await recoverSummaryAsk(current,{fresh:true});
  const quote=raw&&hasAsk(raw)?await executableQuote(raw):null;
  if(!quote||overSignal(state,quote)?.fraction!==verifiedSignal.fraction)return {verified:true,filled:false};
  const [account,positions]=await Promise.all([accountBalance({fresh:true}),allOpenPositions()]);
  const position=positions.market_positions?.find(p=>p.ticker===quote.ticker);
  if(!upgradeEligible(original,position,{...c,market:quote,signal:verifiedSignal}))return {verified:true,filled:false};
  const bankroll=Number(account.balance)+Number(account.portfolio_value);
  const fraction=verifiedSignal.fraction,budget=remainingVerifiedOverCents(position,bankroll,fraction),fees=feeReserve(c.event,quote);
  const spendable=Number(account.balance),price=Number(quote.yes_ask_dollars);
  const desired=profitableCount(contractCount(spendable,quote,fraction,bankroll,budget,fees),price,fees,'over',bankroll,state.type,state.remainingSeconds);
  if(!desired)return {verified:true,filled:false};
  const shard=marketShard(c.event,quote),local=shardCash(account,shard);
  if(local===null)return {verified:true,filled:false};
  const desiredCost=estimatedCostCents(desired,price,fees);
  if(local<desiredCost&&transferPlan(account,shard,desiredCost))await ensureShardFunding({strategy:'over'},c.event,quote,account,desiredCost);
  const count=profitableCount(contractCount(Math.min(spendable,local),quote,fraction,bankroll,budget,fees),price,fees,'over',bankroll,state.type,state.remainingSeconds);
  if(!count)return {verified:true,filled:false};
  const id=randomUUID();
  const reserved=await pool.query(`INSERT INTO ${upgradeTable}(market_ticker,id,original_id,verification_id,status,count,limit_price,available_cents)
    VALUES($1,$2,$3,$4,'reserved',$5,$6,$7)
    ON CONFLICT(market_ticker) DO UPDATE SET id=EXCLUDED.id,original_id=EXCLUDED.original_id,
      verification_id=EXCLUDED.verification_id,status='reserved',count=EXCLUDED.count,limit_price=EXCLUDED.limit_price,
      available_cents=EXCLUDED.available_cents,order_id=NULL,fill_count=0,error=NULL,created_at=now(),updated_at=now()
    WHERE (${upgradeTable}.status='unfilled' AND ${upgradeTable}.updated_at<now()-interval '2 seconds')
       OR (${upgradeTable}.status='rejected' AND ${upgradeTable}.updated_at<now()-interval '15 seconds'
         AND ((${upgradeTable}.error ILIKE '%insufficient%' AND EXCLUDED.available_cents>${upgradeTable}.available_cents)
           OR (${upgradeTable}.error ILIKE '%price%' AND EXCLUDED.limit_price<>${upgradeTable}.limit_price)))
    RETURNING id`,
    [quote.ticker,id,original.id,state.verificationId,count,price,Math.floor(spendable)]);
  if(!reserved.rowCount)return {verified:true,filled:false};
  await pool.query(`CREATE TABLE IF NOT EXISTS order_verifications(order_id uuid PRIMARY KEY,verification_id uuid NOT NULL,created_at timestamptz DEFAULT now())`);
  await pool.query('INSERT INTO order_verifications(order_id,verification_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,state.verificationId]);
  try{
    const result=await withEntryProfitFloor({ticker:quote.ticker,count,price,fees,strategy:'over',bankroll},
      ()=>kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:quote.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}}));
    if(!result){await pool.query(`UPDATE ${upgradeTable} SET status='unfilled',error='Below filled-order net profit floor',updated_at=now() WHERE id=$1`,[id]);return {verified:true,filled:false}}
    const filled=Number(result.fill_count_fp??result.fill_count??result.order?.fill_count_fp??0);
    await pool.query(`UPDATE ${upgradeTable} SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,
      [id,filled>0?'filled':'unfilled',result.order_id||result.order?.order_id||null,filled]);
    if(filled>0)await invalidateBalance();
    return {verified:true,filled:filled>0};
  }catch(e){
    const message=String(e.message),noLiquidity=/^Kalshi 409 .*fill or kill insufficient resting volume/i.test(message),terminal=/^Kalshi (400|401|403|404|422) /.test(message);
    await pool.query(`UPDATE ${upgradeTable} SET status=$2,error=$3,updated_at=now() WHERE id=$1`,
      [id,noLiquidity?'unfilled':terminal?'rejected':'check_order',message.slice(0,250)]);
    console.error('Upgrade order response:',quote.ticker,e.message);
    return {verified:true,filled:false};
  }
}
async function immediatelyUpgradeFilledOver(c,scoreboardCache){
  const firstLive=await liveMilestone(c.milestone.id);
  if(!firstLive)return false;
  firstLive._observed_at=new Date().toISOString();
  const first=gameState(c.milestone,firstLive);
  if(!overSignal(first,c.market)||await auditedOver(first,c.milestone,{cache:scoreboardCache,market:c.market,allowUnavailable:true})!==true)return false;
  const nextLive=await liveMilestone(c.milestone.id);
  if(!nextLive)return false;
  nextLive._observed_at=new Date().toISOString();
  const second=gameState(c.milestone,nextLive);
  if(!confirmedOver(first,second,c.market,0))return false;
  second.verificationId=first.verificationId;
  second.lastScoringPlay=first.lastScoringPlay;
  const verifiedSignal=overSignal(second,c.market);
  if(!verifiedSignal||![.30,.40].includes(verifiedSignal.fraction))return false;
  const {rows:[fill]}=await pool.query(`SELECT id,market_ticker,event_ticker,game_id,sport,strategy,reason,status,combo_legs
    FROM trade_attempts WHERE market_ticker=$1 AND status='filled'`,[c.market.ticker]);
  if(!fill)return false;
  const result=await upgradeHeldOver({...c,state:second,signal:verifiedSignal},{state:second,kalshiOnly:false},fill,scoreboardCache);
  return result.filled;
}
async function verifyHeldLead(c,original,scoreboardCache){
  const first=tableTennisSignal(c.state,c.market)?
    await verifyIndependentTableTennisLeadDecision(c.state,c.milestone):
    await auditedOver(c.state,c.milestone,{cache:scoreboardCache,market:c.market,allowUnavailable:true});
  if(first!==true)return false;
  const next=await liveMilestone(c.milestone.id);if(!next)return false;
  next._observed_at=new Date().toISOString();const second=gameState(c.milestone,next);
  if(!confirmedExternalLead(c.state,second,c.market))return false;
  const current=(await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market;
  if(!current||current.ticker!==original.market_ticker||current.event_ticker!==original.event_ticker||
    current.rules_primary!==c.market.rules_primary||current.floor_strike!==c.market.floor_strike||
    current.cap_strike!==c.market.cap_strike||current.close_time!==c.market.close_time||
    JSON.stringify(current.custom_strike||{})!==JSON.stringify(c.market.custom_strike||{})||
    !(leadSignal(second,current)||additionalLeadSignal(second,current)||cricketLeadSignal(second,current)||drawSignal(second,current)||earlyLeadSignal(second,current)||tennisSignal(second,current)||tableTennisSignal(second,current)))return false;
  const tableTennis=Boolean(tableTennisSignal(second,current));
  if(tableTennis){
    await auditTable();second.verificationId=randomUUID();
    await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',
      [second.verificationId,current.ticker,JSON.stringify({mode:'external_table_tennis_upgrade',first:c.state,second,milestoneId:c.milestone.id})]);
  }else second.verificationId=c.state.verificationId;
  await pool.query(`INSERT INTO fallback_verifications(market_ticker,original_id,verification_id,verified_at) VALUES($1,$2,$3,now())
    ON CONFLICT(market_ticker) DO UPDATE SET original_id=EXCLUDED.original_id,verification_id=EXCLUDED.verification_id,
      first_verified_at=CASE WHEN fallback_verifications.original_id=EXCLUDED.original_id THEN fallback_verifications.first_verified_at ELSE now() END,verified_at=now()`,
    [current.ticker,original.id,second.verificationId]);
  return true;
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
async function reconcileComboUpgrades(){
  await upgradeTables();
  const {rows}=await pool.query(`SELECT market_ticker,rfq_id,quote_id,created_at FROM combo_upgrades
    WHERE status IN ('pending','uncertain') ORDER BY created_at LIMIT 20`);
  for(const row of rows)try{
    const quote=(await kalshi('/communications/rfqs/'+encodeURIComponent(row.rfq_id)+'/quotes/'+encodeURIComponent(row.quote_id),{auth:true})).quote;
    if(!quote)continue;
    if(quote.status==='executed'&&quote.executed_ts&&quote.rfq_creator_order_id){
      const orderId=quote.rfq_creator_order_id;
      const fills=await kalshi('/portfolio/fills?'+new URLSearchParams({ticker:row.market_ticker,min_ts:String(Math.floor(new Date(row.created_at).getTime()/1000)-60),limit:'1000'}),{auth:true});
      const count=(fills.fills||[]).filter(f=>f.ticker===row.market_ticker&&f.order_id===orderId&&
        new Date(f.created_time||f.ts||0)>=new Date(row.created_at))
        .reduce((sum,f)=>sum+Number(f.count_fp??f.count??0),0);
      if(count>0){
        await pool.query(`UPDATE combo_upgrades SET status='filled',order_id=$2,fill_count=$3,updated_at=now()
          WHERE market_ticker=$1 AND status IN ('pending','uncertain')`,[row.market_ticker,orderId,count]);
        await invalidateBalance();
      }
    }else if(['cancelled','expired','rejected','voided'].includes(quote.status)||
      Date.now()-new Date(row.created_at).getTime()>90000&&quote.status==='open'){
      await pool.query(`UPDATE combo_upgrades SET status='unfilled',updated_at=now()
        WHERE market_ticker=$1 AND status IN ('pending','uncertain')`,[row.market_ticker]);
    }
  }catch(e){console.warn('Combo add-on reconciliation deferred:',row.market_ticker,e.message)}
}
async function upgradeVerifiedCombos(scanStarted){
  await upgradeTables();
  const {rows:combos}=await pool.query(`SELECT id,market_ticker,combo_legs,strategy FROM trade_attempts
    WHERE status='filled' AND combo_legs IS NOT NULL AND created_at>now()-interval '14 days' ORDER BY created_at DESC LIMIT 30`);
  if(!combos.length)return false;
  const positions=await allOpenPositions();
  const byTicker=new Map((positions.market_positions||[]).map(p=>[p.ticker,p]));
  for(const combo of combos){
    const fallback=(combo.combo_legs||[]).filter(l=>l.kalshiOnly===true);
    if(!fallback.length)continue;
    const held=byTicker.get(combo.market_ticker);
    if(!held||Number(held.position_fp)<=0)continue;
    const {rows:proofs}=await pool.query(`SELECT market_ticker,verification_id FROM fallback_verifications
      WHERE market_ticker=ANY($1::text[]) AND verified_at >= $2`,[fallback.map(l=>l.market_ticker),scanStarted]);
    if(proofs.length!==fallback.length)continue;
    const prior=await pool.query('SELECT status,updated_at FROM combo_upgrades WHERE market_ticker=$1',[combo.market_ticker]);
    if(prior.rows[0]&&prior.rows[0].status!=='unfilled')continue;
    if(prior.rows[0]&&Date.now()-new Date(prior.rows[0].updated_at).getTime()<20000)continue;
    const market=(await kalshi('/markets/'+encodeURIComponent(combo.market_ticker))).market;
    if(!market||!['active','open'].includes(market.status)||
      market.result&&!['','not_determined'].includes(String(market.result)))continue;
    const account=await accountBalance({fresh:true});
    const bankroll=Number(account.balance)+Number(account.portfolio_value);
    const remaining=remainingVerifiedComboCents(held,bankroll),shard=marketShard({},market);
    const local=shardCash(account,shard),desired=Math.min(remaining,Number(account.balance));
    if(local===null||desired<100)continue;
    if(local<100){if(transferPlan(account,shard,desired))await ensureShardFunding({strategy:combo.strategy},{exchange_index:shard},market,account,desired);continue}
    const budget=comboShardBudget(local,desired);
    if(budget<100)continue;
    const rfq=(await kalshi('/communications/rfqs',{auth:true,method:'POST',body:{market_ticker:combo.market_ticker,
      target_cost_dollars:(budget/100).toFixed(2),rest_remainder:false,obscure_creator_id:true}})).id;
    if(!rfq)continue;
    try{
      const owner=(await kalshi('/communications/id',{auth:true})).communications_id;
      const deadline=Date.now()+COMBO_ATTEMPT_MS;
      while(owner&&Date.now()<deadline){
        const quotes=(await kalshi('/communications/quotes?'+new URLSearchParams({rfq_id:rfq,rfq_creator_user_id:owner,rfq_user_filter:'self',limit:'100'}),{auth:true})).quotes||[];
        const fees=feeReserve(null,market);
        const offers=quotes.map(q=>({q,terms:quoteForYes(q,combo.market_ticker,budget,fees,bankroll)}))
          .filter(o=>o.terms&&profitableCount(o.terms.count,o.terms.yesCost,fees,combo.strategy,bankroll));
        if(offers.length){
          const {q,terms}=offers.sort((a,b)=>b.terms.profitCents-a.terms.profitCents)[0];
          const fresh=await accountBalance({fresh:true}),currentPositions=await allOpenPositions();
          const current=currentPositions.market_positions?.find(p=>p.ticker===combo.market_ticker);
          const currentBankroll=Number(fresh.balance)+Number(fresh.portfolio_value);
          if(!current||terms.debitCents>remainingVerifiedComboCents(current,currentBankroll)||
            terms.debitCents>Number(fresh.balance)||(shardCash(fresh,shard)??0)<terms.debitCents)break;
          const reserved=await pool.query(`INSERT INTO combo_upgrades(market_ticker,original_id,verification_ids,status,rfq_id,quote_id)
            VALUES($1,$2,$3,'pending',$4,$5)
            ON CONFLICT(market_ticker) DO UPDATE SET original_id=EXCLUDED.original_id,
              verification_ids=EXCLUDED.verification_ids,status='pending',rfq_id=EXCLUDED.rfq_id,
              quote_id=EXCLUDED.quote_id,order_id=NULL,fill_count=0,error=NULL,created_at=now(),updated_at=now()
            WHERE combo_upgrades.status='unfilled' AND combo_upgrades.updated_at<now()-interval '20 seconds'
            RETURNING market_ticker`,[combo.market_ticker,combo.id,JSON.stringify(proofs.map(p=>p.verification_id)),rfq,q.id]);
          if(!reserved.rowCount)break;
          try{const accepted=await withEntryProfitFloor({ticker:combo.market_ticker,count:terms.count,price:terms.yesCost,fees,strategy:combo.strategy,bankroll:currentBankroll},
            ()=>kalshi('/communications/rfqs/'+encodeURIComponent(rfq)+'/quotes/'+encodeURIComponent(q.id)+'/accept',
              {auth:true,method:'PUT',body:{accepted_side:'no'}}));
            if(!accepted){await pool.query(`UPDATE combo_upgrades SET status='unfilled',error='Below filled-order net profit floor',updated_at=now() WHERE market_ticker=$1`,[combo.market_ticker]);break}
            await reconcileComboUpgrades()}
          catch(e){await pool.query(`UPDATE combo_upgrades SET status='uncertain',error=$2,updated_at=now() WHERE market_ticker=$1`,[combo.market_ticker,String(e.message).slice(0,250)])}
          return true;
        }
        await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(0,deadline-Date.now()))));
      }
    }finally{await kalshi('/communications/rfqs/'+encodeURIComponent(rfq),{auth:true,method:'DELETE'}).catch(()=>{})}
  }
  return false;
}
 async function executeCombo(group,account,bankroll,fraction,newTicker){
  if(group.length<2){console.warn('Combo held legs unavailable:',group.map(c=>c.market.ticker));return {filled:false,pending:false}}
  const seenMarkets=new Set();
  const eligible=group.filter(c=>{
    if(seenMarkets.has(c.market.ticker))return false;
    seenMarkets.add(c.market.ticker);return true;
  });
  if(eligible.length<2)return {filled:false,pending:false};
  const availableCents=Math.max(0,Math.floor(Number(account.balance)||0));
  if(availableCents<100){
    await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (
      id bigserial PRIMARY KEY,checked_at timestamptz NOT NULL DEFAULT now(),
      leg_tickers jsonb NOT NULL,collection_ticker text,status text NOT NULL,detail text)`);
    await pool.query(`INSERT INTO combo_diagnostics(leg_tickers,status,detail)
      SELECT $1::jsonb,'insufficient_cash',$2 WHERE NOT EXISTS (
        SELECT 1 FROM combo_diagnostics WHERE status='insufficient_cash' AND checked_at>now()-interval '2 minutes')`,[JSON.stringify(eligible.slice(0,2).map(c=>c.market.ticker)),
      `Only $${(availableCents/100).toFixed(2)} available cash; this scanner needs at least $1.00 to buy a separate combination`]);
    console.info('Combo cash unavailable:',availableCents,'cents; held singles',eligible.length);
    return {filled:false,pending:false};
  }
  // Prefer all held, filled legs, then smaller valid combinations.
  const collections=await collectionsForEvents(eligible.map(c=>c.event.event_ticker),kalshi);
  const deadline=Date.now()+COMBO_ATTEMPT_MS;
  const plans=[],funding=[];
  // Consider every held single, sampling distinct leg sets at each collection
  // size without enumerating an exponential number of possible tickets.
  await pool.query('CREATE TABLE IF NOT EXISTS combo_rotation_state (id integer PRIMARY KEY, next_rotation bigint NOT NULL)');
  const {rows:[rotationRow]}=await pool.query(`INSERT INTO combo_rotation_state(id,next_rotation) VALUES(1,1)
    ON CONFLICT(id) DO UPDATE SET next_rotation=combo_rotation_state.next_rotation+1
    RETURNING next_rotation-1 AS rotation`);
  const rotation=Number(rotationRow.rotation),groups=plannedComboGroups(collections,eligible,COMBO_RFQ_PLANS,rotation);
  console.info('Combo coverage:',JSON.stringify({held:eligible.length,possiblePairs:eligible.length*(eligible.length-1)/2,collections:collections.length,plannedBySize:Object.fromEntries([...new Set(groups.map(g=>g.legs.length))].map(n=>[n,groups.filter(g=>g.legs.length===n).length])),rotation}));
  if(!groups.length){
    console.warn('Combo no compatible collection for trigger:',newTicker,eligible.map(c=>[c.event.event_ticker,c.market.ticker]),'collections',collections.length);
    await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (
      id bigserial PRIMARY KEY,checked_at timestamptz NOT NULL DEFAULT now(),
      leg_tickers jsonb NOT NULL,collection_ticker text,status text NOT NULL,detail text)`);
    for(const pair of comboPairDiagnostics(collections,eligible)){
      const legTickers=JSON.stringify(pair.tickers);
      const recent=await pool.query(`SELECT 1 FROM combo_diagnostics WHERE leg_tickers=$1::jsonb
        AND status='no_compatible_collection' AND checked_at>now()-interval '2 minutes' LIMIT 1`,[legTickers]);
      if(!recent.rowCount)await pool.query(`INSERT INTO combo_diagnostics(leg_tickers,status,detail)
        VALUES($1,'no_compatible_collection',$2)`,[legTickers,
        `No Kalshi all-YES collection includes both held events among ${collections.length} event-filtered collections`]);
    }
  }
  await mapBatches(groups,5,async ({legs,collection})=>{
    const n=legs.length;
    try{
      const identifiers=selectedComboMarkets(legs);
      const created=await kalshi('/multivariate_event_collections/'+encodeURIComponent(collection.collection_ticker),{auth:true,method:'POST',body:{selected_markets:identifiers,with_market_payload:true}});
      console.info('Combo held-leg market creation:',legs.map(c=>c.market.ticker),created.market_ticker||'missing ticker');
      const ticker=created.market_ticker,combo=created.market;
      if(!ticker||!combo||combo.ticker!==ticker||combo.event_ticker!==created.event_ticker||!['initialized','active','open'].includes(combo.status))return;
      const strategy=legs.some(c=>c.signal.strategy==='over')?'over':'lead';
      // The fallback and independently verified combination ceilings are
      // selected from the current leg verification state.
      const groupFraction=comboLegAllocation(legs,fraction);
      const shard=marketShard({exchange_index:collection.exchange_index},combo),local=shardCash(account,shard);
      const desired=Math.floor(Math.min(Number(account.balance),comboAllowedCents(groupFraction,bankroll)));
      if(local===null||desired<100)return;
      if(local<100&&transferPlan(account,shard,desired)){funding.push({strategy,created,combo,desired});return}
      const budget=comboShardBudget(local,desired);
      if(budget<100)return;
      const existing=await pool.query(`SELECT status FROM trade_attempts WHERE market_ticker=$1`,[ticker]);
      if(existing.rows.some(r=>['filled','combo_pending','reserved','check_order'].includes(r.status)))return;
      if(Date.now()>=deadline)return;
      const rfq=(await kalshi('/communications/rfqs',{auth:true,method:'POST',body:{market_ticker:ticker,target_cost_dollars:(comboRfqTargetCents(budget)/100).toFixed(2),rest_remainder:false,obscure_creator_id:true,replace_existing:true}})).id;
      if(rfq)plans.push({legs,created,collection:collection.collection_ticker,ticker,combo,strategy,fraction:groupFraction,shard,budget,rfq});
     }catch(e){console.warn('Combo size unavailable:',n,collection.collection_ticker,legs.map(c=>[c.event.event_ticker,c.market.ticker]),e.message)}
  });
  if(!plans.length){console.warn('Combo no executable RFQ plan:',newTicker,'groups',groups.length,'funding',funding.length);if(funding.length){const p=funding[0];await ensureShardFunding({strategy:p.strategy},p.created,p.combo,account,p.desired)}return {filled:false,pending:false}}
  const quoteStats=new Map(plans.map(p=>[p.ticker,{received:0,eligible:0,sellOffers:0}]));
  try{
    const communicationsId=(await kalshi('/communications/id',{auth:true})).communications_id;
    if(!communicationsId)throw new Error('Kalshi communications ID missing');
    console.info('Combo quote owner filter ready:',plans.length,'RFQs');
    while(Date.now()<deadline){
      const offers=(await mapBatches(plans,6,async plan=>{
        try{
          const list=(await kalshi('/communications/quotes?'+new URLSearchParams({rfq_id:plan.rfq,rfq_creator_user_id:communicationsId,rfq_user_filter:'self',limit:'100'}),{auth:true})).quotes||[];
          const fees=feeReserve({fee_multiplier_override:plan.combo.fee_multiplier_override},plan.combo);
          const eligible=list.map(q=>({plan,q,terms:quoteForYes(q,plan.ticker,plan.budget,fees,bankroll),fees})).filter(x=>x.terms&&
            profitableCount(x.terms.count,x.terms.yesCost,fees,plan.strategy,bankroll,plan.legs[0].state.type,plan.legs[0].state.remainingSeconds));
          const stats=quoteStats.get(plan.ticker);stats.received=Math.max(stats.received,list.length);stats.eligible=Math.max(stats.eligible,eligible.length);
          stats.sellOffers=Math.max(stats.sellOffers,list.filter(q=>Number(q.no_bid_dollars)>0&&Number(q.no_contracts_fp??q.contracts_fp)>0).length);
          if(list.length&&!stats.sample){const q=list[0],terms=quoteForYes(q,plan.ticker,plan.budget,fees,bankroll);
            stats.sample={status:q.status,no_bid_dollars:q.no_bid_dollars,yes_bid_dollars:q.yes_bid_dollars,no_contracts_fp:q.no_contracts_fp,contracts_fp:q.contracts_fp,age_seconds:Math.round((Date.now()-Date.parse(q.created_ts))/1000),budget_cents:plan.budget,fee_inclusive_cents:quoteForYes(q,plan.ticker,Infinity,fees,bankroll)?.debitCents??null,terms,profit_passed:!!terms&&!!profitableCount(terms.count,terms.yesCost,fees,plan.strategy,bankroll,plan.legs[0].state.type,plan.legs[0].state.remainingSeconds)};
          }
          return eligible;
        }catch(e){console.warn('Combo quotes unavailable:',plan.ticker,e.message);if(e.message.includes('Kalshi 403 GET /communications/quotes'))throw e;return []}
      })).flat().sort((a,b)=>b.plan.legs.length-a.plan.legs.length||Number(b.plan.legs.some(c=>c.market.ticker===newTicker))-Number(a.plan.legs.some(c=>c.market.ticker===newTicker))||b.terms.profitCents-a.terms.profitCents);
      for(const {q,terms,plan,fees} of offers){
        const {legs,ticker,strategy,fraction,shard,rfq,created}=plan;
        // Confirm holdings and tradability immediately before accepting a quote.
        const [positions,latestCombo]=await Promise.all([allOpenPositions(),liveComboMarket(kalshi,ticker)]);
        const held=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>p.ticker));
        if(legs.some(c=>!held.has(c.market.ticker))||!latestCombo)continue;
        if(Date.now()>=deadline)break;
        const latest=await accountBalance({fresh:true});
        if(Number(latest.balance)<terms.debitCents || (shardCash(latest,shard)??0)<terms.debitCents ||
          terms.debitCents>comboAllowedCents(fraction,Number(latest.balance)+Number(latest.portfolio_value)) ||
          !profitableCount(terms.count,terms.yesCost,fees,strategy,Number(latest.balance)+Number(latest.portfolio_value),legs[0].state.type,legs[0].state.remainingSeconds))continue;
        const id=randomUUID(),reason=`${legs.length}-pick ${strategy} combo: ${legs.map(c=>c.state.title).join(' / ')}`;
        const inserted=await pool.query(`INSERT INTO trade_attempts(id,market_ticker,event_ticker,game_id,sport,strategy,reason,fraction,count,limit_price,available_cents,status,combo_legs,combo_rfq_id,combo_quote_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'combo_pending',$12,$13,$14)
          ON CONFLICT DO NOTHING RETURNING id`,
          [id,ticker,created.event_ticker,legs[0].milestone.id,legs[0].state.sport,strategy,reason,fraction,terms.count,terms.yesCost,Number(latest.balance),JSON.stringify(comboLegs(legs)),rfq,q.id]);
        if(!inserted.rowCount)continue;
        try{
          // Accepting the maker's NO bid buys YES (the complementary price).
          const accepted=await withEntryProfitFloor({ticker,count:terms.count,price:terms.yesCost,fees,strategy,bankroll:Number(latest.balance)+Number(latest.portfolio_value)},
            ()=>kalshi('/communications/rfqs/'+encodeURIComponent(rfq)+'/quotes/'+encodeURIComponent(q.id)+'/accept',{auth:true,method:'PUT',body:{accepted_side:'no'}}));
          if(!accepted){await pool.query(`UPDATE trade_attempts SET status='unfilled',error='Below filled-order net profit floor',updated_at=now() WHERE id=$1`,[id]);continue}
          await reconcileCombos();
          return {filled:true,pending:true,legs,ticker};
        }catch(e){console.error('Combo accept uncertain; reconciliation required:',ticker,e.message);return {filled:false,pending:true,legs,ticker}}
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(800,Math.max(0,deadline-Date.now()))));
    }
  }finally{await Promise.all(plans.map(p=>kalshi('/communications/rfqs/'+encodeURIComponent(p.rfq),{auth:true,method:'DELETE'}).catch(e=>console.warn('RFQ cancellation deferred:',e.message))))}
  console.info('Combo quote counts:',JSON.stringify([...quoteStats]));
  console.info('Combo maker quote unavailable:',newTicker,'RFQs',plans.map(p=>p.rfq));
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (
    id bigserial PRIMARY KEY,checked_at timestamptz NOT NULL DEFAULT now(),
    leg_tickers jsonb NOT NULL,collection_ticker text,status text NOT NULL,detail text)`);
  for(const plan of plans){
    const stats=quoteStats.get(plan.ticker);
    const reason=stats?.received&&!stats.sellOffers?
      `Kalshi created this combo and returned ${stats.received} maker quote(s), but no maker offered to sell YES`:
      stats?.sample?.fee_inclusive_cents>plan.budget?
      `Kalshi quoted this combo, but the full price plus fees exceeded the ${plan.budget}-cent bankroll cap`:
      stats?.received?`Kalshi returned ${stats.received} maker quotes; none passed the executable cost and profit checks`:'Kalshi returned no maker quote';
    await pool.query(`INSERT INTO combo_diagnostics(leg_tickers,collection_ticker,status,detail)
      VALUES($1,$2,'no_executable_quote',$3)`,[JSON.stringify(plan.legs.map(c=>c.market.ticker)),plan.collection,reason]);
  }
  return {filled:false,pending:false};
}
async function checkHeldCombinations(fills){
  // Establish a one-time baseline before this deployment can submit new buys.
  // Existing holdings are legs for future fills, not triggers on their own.
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_fill_baseline (
    id integer PRIMARY KEY,started_at timestamptz NOT NULL)`);
  await pool.query(`INSERT INTO combo_fill_baseline(id,started_at) VALUES(1,clock_timestamp()) ON CONFLICT DO NOTHING`);
  const {rows:[baseline]}=await pool.query('SELECT started_at FROM combo_fill_baseline WHERE id=1');
  const positions=await allOpenPositions();
  const held=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>p.ticker));
  const used=await pool.query(`SELECT combo_legs FROM trade_attempts WHERE combo_legs IS NOT NULL AND status IN ('filled','combo_pending')`);
  const unverifiedUsed=new Set(used.rows.flatMap(r=>(r.combo_legs||[]).map(l=>l.market_ticker)));
  const available=availableComboFills(fills,unverifiedUsed);
  const singles=filledComboWindow(available,held,null);
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_fill_triggers (
    fill_id uuid PRIMARY KEY, attempted_at timestamptz, completed_at timestamptz, combo_ticker text)`);
  await pool.query('ALTER TABLE combo_fill_triggers ADD COLUMN IF NOT EXISTS combo_ticker text');
  const ready=await pool.query(`SELECT a.id,a.market_ticker FROM trade_attempts a
    LEFT JOIN combo_fill_triggers t ON t.fill_id=a.id
    WHERE a.status='filled' AND a.combo_legs IS NULL AND a.market_ticker=ANY($1::text[])
      AND a.updated_at>=$2 AND t.fill_id IS NULL
    ORDER BY a.created_at ASC LIMIT 25`,[[...held],baseline.started_at]);
  if(!ready.rowCount)return {filled:false,pending:false};
  const trigger=ready.rows[0];
  const claimed=await pool.query(`INSERT INTO combo_fill_triggers(fill_id,attempted_at)
    VALUES($1,now()) ON CONFLICT DO NOTHING RETURNING fill_id`,[trigger.id]);
  if(!claimed.rowCount)return {filled:false,pending:false};
  if(singles.length<2)return {filled:false,pending:false};
  await ensureScoreTime();
  const snapshots=await pool.query('SELECT id,title,sport,sport_family,home,away,status,signals,GREATEST(score_observed_at,scanned_at) AS scanned_at,clock_seconds FROM game_snapshots WHERE id=ANY($1::text[])',
    [[...new Set(singles.map(r=>r.game_id))]]);
  const byGame=new Map(snapshots.rows.map(s=>[s.id,s]));
  const candidates=(await Promise.all(singles.map(async row=>{
    try{const {market}=await kalshi('/markets/'+encodeURIComponent(row.market_ticker));
      return heldComboLeg(row,market,byGame.get(row.game_id));
    }catch(e){console.warn('Held combo market unavailable:',row.market_ticker,e.message);return null}
  }))).filter(Boolean);
  if(candidates.length<2){console.info('Combo fewer than two open held legs:',singles.map(r=>r.market_ticker));return {filled:false,pending:false}}
  const account=await accountBalance({fresh:true});
  const result=await executeCombo(candidates,account,Number(account.balance)+Number(account.portfolio_value),comboAllocation(),trigger.market_ticker);
  await pool.query('UPDATE combo_fill_triggers SET completed_at=now(),combo_ticker=$2 WHERE fill_id=$1',[trigger.id,result.ticker||null]);
  return result;
}
async function diagnoseUnfilledCombo(candidates,filled){
  const unfilled=candidates.filter(c=>hasAsk(c.market)&&!filled.has(signalKey(c)));
  if(unfilled.length<2)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (
    id bigserial PRIMARY KEY,checked_at timestamptz NOT NULL DEFAULT now(),
    leg_tickers jsonb NOT NULL,collection_ticker text,status text NOT NULL,detail text)`);
  const recent=await pool.query(`SELECT 1 FROM combo_diagnostics WHERE checked_at>now()-interval '2 minutes' LIMIT 1`);
  if(recent.rowCount)return;
  const unique=new Map();
  for(const c of unfilled){if(!unique.has(c.event.event_ticker))unique.set(c.event.event_ticker,c);if(unique.size===6)break}
  const legs=[...unique.values()];
  if(legs.length<2)return;
  let collection=null,status='no_compatible_collection',detail='';
  try{
    const collections=await collectionsForEvents(legs.map(c=>c.event.event_ticker),kalshi);
    const group=compatibleComboGroups(collections,legs,64)[0];
    if(group){
      collection=group.collection.collection_ticker;
      const selected_markets=selectedComboMarkets(group.legs);
      try{
        const created=await kalshi('/multivariate_event_collections/'+encodeURIComponent(collection),
          {auth:true,method:'POST',body:{selected_markets,with_market_payload:true}});
        status=created.market_ticker?'market_created':'invalid_response';
        detail=created.market_ticker||JSON.stringify(created).slice(0,500);
      }catch(e){status='creation_error';detail=String(e.message).slice(0,500)}
    }else detail=`No all-YES collection among ${collections.length} event-filtered collections; ${legs.length} distinct events`;
  }catch(e){status='collection_error';detail=String(e.message).slice(0,500)}
  await pool.query(`INSERT INTO combo_diagnostics(leg_tickers,collection_ticker,status,detail) VALUES($1,$2,$3,$4)`,
    [JSON.stringify(legs.map(c=>c.market.ticker)),collection,status,detail]);
  console.info('Unfilled combo creation diagnostic:',status,collection,detail);
}
async function diagnoseHeldCombinations(fills,positions){
  const held=new Set((positions?.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>p.ticker));
  const byEvent=new Map();
  for(const row of filledComboWindow(fills,held,null,25)){
    const group=byEvent.get(row.event_ticker)||[];
    group.push(row);byEvent.set(row.event_ticker,group);
  }
  const singles=[...byEvent.values()].find(group=>group.length>=3)?.slice(0,3)||[];
  if(singles.length!==3)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (
    id bigserial PRIMARY KEY,checked_at timestamptz NOT NULL DEFAULT now(),
    leg_tickers jsonb NOT NULL,collection_ticker text,status text NOT NULL,detail text)`);
  const legs=singles.map(r=>({event:{event_ticker:r.event_ticker},market:{ticker:r.market_ticker}}));
  const collections=await collectionsForEvents(legs.map(c=>c.event.event_ticker),kalshi);
  const groups=compatibleComboGroups(collections,legs,8);
  if(!groups.length)console.warn('Held combo diagnostic: no compatible pair or triple collection',legs.map(c=>c.market.ticker));
  for(const {legs:part,collection} of groups){
    const tickers=part.map(c=>c.market.ticker),key=JSON.stringify(tickers);
    const {rowCount}=await pool.query(`SELECT 1 FROM combo_diagnostics WHERE leg_tickers=$1::jsonb
      AND (status='held_market_created' OR checked_at>now()-interval '2 minutes') LIMIT 1`,[key]);
    if(rowCount)continue;
    let status='held_market_created',detail='';
    try{
      const result=await kalshi('/multivariate_event_collections/'+encodeURIComponent(collection.collection_ticker),
        {auth:true,method:'POST',body:{selected_markets:selectedComboMarkets(part),with_market_payload:true}});
      detail=result.market_ticker||'No market ticker returned';
      if(!result.market_ticker)status='held_invalid_response';
    }catch(e){status='held_creation_error';detail=String(e.message).slice(0,500)}
    await pool.query(`INSERT INTO combo_diagnostics(leg_tickers,collection_ticker,status,detail) VALUES($1,$2,$3,$4)`,
      [key,collection.collection_ticker,status,detail]);
    console.info('Held combo market diagnostic:',status,tickers,detail);
  }
}
async function exitComebacks(games,events,positions){
  const byGame=new Map(games.map(g=>[g.milestone.id,g.state]));
  const gameInfo=new Map(games.map(g=>[g.milestone.id,g]));
  const markets=new Map([...events.values()].flatMap(e=>(e.markets||[]).map(m=>[m.ticker,m])));
  const marketGames=new Map(games.flatMap(g=>linkedEventTickers(g.milestone).flatMap(t=>(events.get(t)?.markets||[]).map(m=>[m.ticker,g.milestone.id]))));
  const held=(positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0);
  if(!held.length)return;
  const recorded=await pool.query(`SELECT DISTINCT ON (market_ticker) market_ticker,game_id,sport,strategy,reason,status,combo_legs FROM trade_attempts WHERE status='filled' ORDER BY market_ticker,updated_at DESC`);
  const ownership=new Map(recorded.rows.map(r=>[r.market_ticker,r]));
  const salesTable=await pool.query("SELECT to_regclass('manual_sales') AS name");
  const manualPending=new Set(salesTable.rows[0]?.name?(await pool.query("SELECT ticker FROM manual_sales WHERE status='pending'")).rows.map(r=>r.ticker):[]);
  for(const position of held){
    const original=ownership.get(position.ticker),gameId=original?.game_id||marketGames.get(position.ticker),state=byGame.get(gameId),nested=markets.get(position.ticker);
    if(!original||manualPending.has(position.ticker))continue;
    const strategy='lead';
    const combo=Array.isArray(original.combo_legs)&&original.combo_legs.length>=2;
    const leadPosition=original.strategy==='lead'&&!/TOTAL/i.test(position.ticker);
    const leadExit=leadPosition&&!combo;
    const reversed=leadExit&&state?.verifiedLive&&nested&&comeback(state,nested,strategy);
    try{
      const correctionLegs=[];
      for(const leg of combo?original.combo_legs.map(leg=>({row:ownership.get(leg.market_ticker),game:gameInfo.get(leg.game_id)})):
        [{row:original,game:gameInfo.get(gameId)}]){
        if(leg.row?.strategy!=='over'||!leg.game?.state?.verifiedLive)continue;
        const legMarket=markets.get(leg.row.market_ticker)||
          (await kalshi('/markets/'+encodeURIComponent(leg.row.market_ticker))).market;
        if(overCorrectionAffects(leg.row,leg.game.state,legMarket))correctionLegs.push({...leg,market:legMarket});
      }
      // Re-read the live score immediately. Do not wait for the profit target
      // or the normal comeback dwell when a corrected statistic uncrosses an over.
      let corrected=false;
      for(const leg of correctionLegs){
        const raw=await liveMilestone(leg.game.milestone.id);
        if(!raw)continue;
        raw._observed_at=new Date().toISOString();
        if(overCorrectionAffects(leg.row,gameState(leg.game.milestone,raw),leg.market)){corrected=true;break}
      }
      const market=(await kalshi('/markets/'+encodeURIComponent(position.ticker))).market;
      if(!market||!['active','open'].includes(market.status))continue;
      const book=(await kalshi('/markets/'+encodeURIComponent(position.ticker)+'/orderbook')).orderbook_fp;
      const heldCount=Number(position.position_fp??position.position);
      const sale=sellQuote(book,heldCount,market.fractional_trading_enabled===false);
      if(!sale||sale.count<minimumCount(market))continue;
      // Soccer commanding leads stay open for settlement or an independently
      // confirmed comeback; a corrected over can still exit immediately.
      const targetReached=profitTargetAllowed(original)&&sale.count>=heldCount-1e-7&&
        (leadPosition?halfPotentialProfitExitEligible(position,sale):oneAndHalfExitEligible(position,sale));
      if(!leadExit&&!targetReached&&!corrected)continue;
      if(!targetReached&&!reversed&&!corrected)continue;
      const reversing=[{game:gameInfo.get(gameId),market:nested,event:events.get(nested?.event_ticker)}];
      let confirmed=targetReached||corrected;
      for(const leg of confirmed?[]:reversing){
        if(!leg.game?.state?.verifiedLive||!leg.market)continue;
        const first=leg.game.state;
        const firstIndependent=first.golf?await verifyGolf(first,leg.game.milestone,leg.event):
          first.tableTennis?await verifyIndependentTableTennisMatch(first,leg.game.milestone):
          await auditedOver(first,leg.game.milestone,{market:leg.market,allowUnavailable:true});
        if(firstIndependent===false)continue;
        const remaining=firstIndependent===true?0:VERIFY_DWELL_MS-(Date.now()-first.observedAt);
        if(!Number.isFinite(remaining))continue;
        if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
        const raw=await liveMilestone(leg.game.milestone.id);
        if(!raw)continue;
        raw._observed_at=new Date().toISOString();
        const second=gameState(leg.game.milestone,raw);
        if(second.feedId!==first.id||second.observedAt-first.observedAt<(firstIndependent===true?1:VERIFY_DWELL_MS)||
          Number.isFinite(first.updatedAt)&&Number.isFinite(second.updatedAt)&&second.updatedAt<first.updatedAt||
          !comeback(second,leg.market,strategy))continue;
        const independent=second.golf?await verifyGolf(second,leg.game.milestone,leg.event):
          second.tableTennis?await verifyIndependentTableTennisMatch(second,leg.game.milestone):
          await auditedOver(second,leg.game.milestone,{market:leg.market,firstObservation:first});
        if(independent===true){confirmed=true;break}
      }
      if(!confirmed)continue;
      const bid=sale.price,bidSize=sale.count;
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
        const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:position.ticker,client_order_id:id,side:'ask',count:count.toFixed(2),price:bid.toFixed(4),time_in_force:targetReached&&!corrected?'fill_or_kill':'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,reduce_only:true}});
        const filledCount=Number(result.fill_count_fp??result.fill_count??0);
        await pool.query(`UPDATE exit_attempts SET status=$2,order_id=$3,filled_count=$4,updated_at=now() WHERE id=$1`,[id,filledCount>0?'filled':'unfilled',result.order_id||null,filledCount]);
        if(filledCount>0)await invalidateBalance();
      }catch(e){
        await pool.query(`UPDATE exit_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,/^Kalshi (400|401|403|404|422) /.test(String(e.message))?'unfilled':'uncertain',String(e.message).slice(0,250)]);
        console.error('Exit order response:',position.ticker,e.message);
      }
    }catch(e){console.error('Position exit deferred:',position.ticker,e.message)}
  }
}
// A full discovery scan can take many seconds. Poll only the live games behind
// held overs throughout the cron invocation, so a statistic correction
// does not wait for discovery, candidate verification or combo RFQs.
async function watchCorrectedOvers(until){
  let rows=[],marketsByTicker=new Map(),nextRefresh=0;
  while(Date.now()<until){
    const started=Date.now();
    try{
      if(started>=nextRefresh){
        const result=await pool.query(`SELECT DISTINCT ON (a.market_ticker) a.market_ticker,a.game_id,a.sport,a.strategy,a.reason,a.combo_legs,
          g.title,g.sport_family,g.sport AS game_sport,g.home_team_id,g.away_team_id,g.status AS game_status
          FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id
          WHERE a.status='filled' AND (a.strategy='over' OR a.combo_legs IS NOT NULL)
          ORDER BY a.market_ticker,a.updated_at DESC`);
        rows=result.rows;
        const overRows=rows.filter(row=>row.strategy==='over'&&row.game_status==='live'&&row.sport_family);
        const quotes=await Promise.all(overRows.map(async row=>{
          try{return [row.market_ticker,(await kalshi('/markets/'+encodeURIComponent(row.market_ticker))).market]}
          catch{return [row.market_ticker,null]}
        }));
        marketsByTicker=new Map(quotes.filter(([,market])=>market));
        nextRefresh=Date.now()+5000;
      }
      const singles=rows.filter(row=>row.strategy==='over'&&row.game_status==='live'&&
        row.sport_family&&marketsByTicker.has(row.market_ticker));
      const milestones=[...new Map(singles.map(row=>[row.game_id,{id:row.game_id,title:row.title,
        type:row.sport_family,details:{league:row.game_sport,home_team_id:row.home_team_id,away_team_id:row.away_team_id}}])).values()];
      if(milestones.length){
        const data=await liveBatch(milestones);
        const games=milestones.map(milestone=>({milestone,state:gameState(milestone,data.get(milestone.id))}));
        const states=new Map(games.map(game=>[game.milestone.id,game.state]));
        const target=correctionExitTargets(rows,states,marketsByTicker);
        if(target.size){
          const positions=await allOpenPositions();
          const held=(positions.market_positions||[]).filter(position=>target.has(position.ticker)&&
            Number(position.position_fp??position.position)>0);
          if(held.length){
            const events=new Map([...marketsByTicker.values()].map(market=>[market.event_ticker,
              {event_ticker:market.event_ticker,markets:[...marketsByTicker.values()].filter(candidate=>candidate.event_ticker===market.event_ticker)}]));
            await exitComebacks(games,events,{market_positions:held});
          }
        }
      }
    }catch(e){console.error('Fast over correction exit deferred:',e)}
    const pause=Math.max(0,2000-(Date.now()-started));
    if(Date.now()+pause>=until)break;
    if(pause)await new Promise(resolve=>setTimeout(resolve,pause));
  }
}
async function nws(path){
  const response=await fetch('https://api.weather.gov'+path,{headers:{accept:'application/geo+json','user-agent':'K-Kalshi-weather-verification (station observations)'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error(`NWS ${response.status}`);
  return response.json();
}
async function twc(path){
  if(!/^\/api\/(?:climate\/primary\?date=\d{4}-\d{2}-\d{2}|metar\?primary=true&weekStart=\d{4}-\d{2}-\d{2})$/.test(path))throw Error('Unsupported weather data request');
  const response=await fetch('https://weather.com/kalshi'+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Weather Company ${response.status}`);
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
    const count=profitableCount(contractCount(balance,item.market,.10,bankroll,Infinity,fee),Number(item.market.yes_ask_dollars),fee,'weather',bankroll);
    return {...item,profit:netSettlementProfitCents(count,Number(item.market.yes_ask_dollars),fee)};
  }).sort((a,b)=>b.profit-a.profit);
  for(const item of ranked){
    if(item.profit<30)continue;
    const latestMarket=(await kalshi('/markets/'+encodeURIComponent(item.market.ticker))).market;
    if(!latestMarket||latestMarket.rules_primary!==item.market.rules_primary||latestMarket.close_time!==item.market.close_time||
      !weatherContract(event,latestMarket,{id:item.contract.station,timezone:item.contract.timezone}))continue;
    const recovered=await recoverSummaryAsk(latestMarket);
    const quote=hasAsk(recovered)?await executableQuote(recovered):null;
    if(!quote)continue;
    const fresh=await accountBalance({fresh:true}),cash=Number(fresh.balance),total=cash+Number(fresh.portfolio_value);
     const spendable=cash;
    const fee=feeReserve(event,quote),count=profitableCount(contractCount(spendable,quote,.10,total,Infinity,fee),Number(quote.yes_ask_dollars),fee,'weather',total);
    if(!count)continue;
    const shard=marketShard(event,quote),local=shardCash(fresh,shard),cost=estimatedCostCents(count,Number(quote.yes_ask_dollars),fee);
    if(local===null)continue;
     const signal={strategy:'weather',fraction:.10,reason:`${item.contract.type} ${item.observed.value.toFixed(2)} at ${item.contract.station} on ${item.contract.localDate}; ${item.contract.comparison} ${item.contract.threshold}`};
    if(local<cost&&transferPlan(fresh,shard,cost))await ensureShardFunding(signal,event,quote,fresh,cost);
    const affordable=profitableCount(contractCount(Math.min(spendable,local),quote,.10,total,Infinity,fee),Number(quote.yes_ask_dollars),fee,'weather',total);
    if(!affordable||netSettlementProfitCents(affordable,Number(quote.yes_ask_dollars),fee)<30)continue;
    await auditTable();const verificationId=randomUUID();
    await pool.query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',[verificationId,quote.ticker,JSON.stringify({contract:item.contract,kalshiFirst:{at:item.firstAt,market:item.first},kalshiSecond:{at:item.secondAt,market:item.second},external:item.observed,executable:{price:quote.yes_ask_dollars,size:quote.yes_ask_size_fp,count:affordable,feeReserve:fee,projectedNetCents:netSettlementProfitCents(affordable,Number(quote.yes_ask_dollars),fee)}})]);
    const game={id:'weather:'+event.event_ticker,sport:'Weather',type:'weather',verificationId};
    await pool.query(`INSERT INTO game_snapshots(id,title,sport,sport_family,status,scanned_at,signals) VALUES($1,$2,'Weather','weather','live',now(),'[]')
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,scanned_at=now()`,[game.id,event.title]);
    if(await submit(signal,game,event,quote,Math.min(spendable,local),total))await pool.query('UPDATE weather_scan_status SET orders_submitted=orders_submitted+1 WHERE id=1');
    break;
  }
}
async function scan(cachedMilestones,discoveryCount){
  // A transaction-scoped lock is released by Postgres even if an invocation is terminated.
  // Snapshot writes use other pool connections so the dashboard sees each completed cycle.
  const client=await pool.connect();await client.query('BEGIN');
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(83027543) AS acquired');
  if(!lock.rows[0].acquired){await client.query('ROLLBACK');client.release();return {skipped:'scan in progress'}};
  let scanned=0,signals=0,submitted=0,ms;const executionErrors=[],scanStarted=new Date();let openPositions=null;
  try{
    if(live()||exitOnly())await Promise.all([reconcileCombos(),reconcileComboUpgrades()]);
    if(live()&&!cachedMilestones)try{await reconcileFundingTransfers()}catch(e){console.warn('Transfer history unavailable:',e.message)}
    ms=cachedMilestones||await milestones();discoveryCount??=ms.length;
    await upgradeTables();
    await ensureScanStatus();const liveMap=await liveBatch(ms);
    const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))})).filter(g=>
      g.state.verifiedLive||Date.parse(g.milestone.start_date||'')>Date.now()-3600000);
    const active=games.filter(g=>g.state.verifiedLive && g.state.scoreKnown);
    const events=await marketMap(active.filter(g=>eligibleForMarkets(g.state)).flatMap(g=>linkedEventTickers(g.milestone)));
    // Market discovery can take longer than a scoring play. Refresh live
    // player stats immediately before deciding which props crossed their line.
    const currentLive=await liveBatch(active.map(g=>g.milestone));
    for(const game of active){const latest=currentLive.get(game.milestone.id);if(latest){liveMap.set(game.milestone.id,latest);game.state=gameState(game.milestone,latest)}}
    let balance=0,bankroll=0,account=null;
    const existingFills=await pool.query(`SELECT id,market_ticker,event_ticker,game_id,sport,strategy,reason,fill_count,limit_price,created_at,updated_at,combo_legs,status FROM trade_attempts WHERE status='filled'`);
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
      if(live())try{await stageCashAcrossShards(account,bankroll)}catch(e){console.warn('Early shard staging deferred:',e.message)}
    }
    // Exits are assessed before any new risk is added.
    if(live()||exitOnly())await exitComebacks(games,events,openPositions);
    // Begin held combo discovery after exits while the ordinary signal scan
    // proceeds. The final quote acceptance rechecks held legs and cash.
    const comboJob=live()?pool.query(`SELECT a.id,a.market_ticker,a.event_ticker,a.game_id,a.sport,a.strategy,a.reason,a.fraction,a.fill_count,a.limit_price,a.created_at,a.updated_at,a.combo_legs,
      EXISTS(SELECT 1 FROM fallback_verifications f WHERE f.market_ticker=a.market_ticker AND f.original_id=a.id AND f.verified_at >= $1) AS externally_verified
      FROM trade_attempts a WHERE a.status='filled'`,[scanStarted])
      .then(({rows})=>checkHeldCombinations(rows))
      .catch(e=>{console.error('Held combo execution deferred:',e);return {error:e.message}}):Promise.resolve(null);
    await Promise.all([candidateTable(),ensureValueScan()]);
    const opportunities=[],snapshotRows=new Map(),scoreboardCache=new Map();
    const valueObservations=[];
    const allCandidates=[],upgradeCandidates=[],snapshotCandidates=new Map();
    const upgradeFills=new Map(existingFills.rows.filter(r=>r.strategy==='over'||r.strategy==='lead'&&/Kalshi-only/i.test(r.reason||'')).map(r=>[r.market_ticker,r]));
    const heldPositions=new Map((openPositions?.market_positions||[]).map(p=>[p.ticker,p]));
    for(const {milestone,state} of games){
      const candidates=[];
      const valueSignals=[];
      if(eligibleForMarkets(state))for(const ticker of linkedEventTickers(milestone)){const event=events.get(ticker);if(!event || !['Sports','Esports'].includes(event.category))continue;
        for(const market of event.markets||[]){if(market.event_ticker!==event.event_ticker)continue;
          const value=valueCandidate(state,market,event);
          if(value){valueSignals.push(value);valueObservations.push({gameId:state.id,value,state,market})}
          const signal=overSignal(state,market)||golfSignal(state,market)||leadSignal(state,market)||additionalLeadSignal(state,market)||cricketLeadSignal(state,market)||drawSignal(state,market)||earlyLeadSignal(state,market)||tennisSignal(state,market)||tableTennisSignal(state,market);if(signal)candidates.push({signal,event,market,state,milestone})}}
      // Keep crossed, already-filled props visible with their status, but do
      // not send them through order preflight or count them as new candidates.
      allCandidates.push(...candidates.filter(c=>!filled.has(signalKey(c))));
      for(const c of candidates){
        const original=upgradeFills.get(c.market.ticker);
        const position=heldPositions.get(c.market.ticker);
        if(upgradeEligible(original,position,c)||original?.status==='filled'&&original.strategy==='lead'&&
          c.signal.strategy==='lead'&&c.market.ticker===original.market_ticker&&c.event.event_ticker===original.event_ticker&&
          c.milestone.id===original.game_id&&Number(position?.position_fp)>0)
          upgradeCandidates.push({...c,upgradeFill:original});
      }
      snapshotCandidates.set(state.id,candidates);
      if(state.verifiedLive)scanned++;
      const baseball=/baseball/.test(state.type),tennis=/tennis/.test(state.type),soccer=/soccer/.test(state.type);
      const timeLeft=gameTimeLabel(state);
      const preciseClockSeconds=state.verifiedLive?(soccer&&Number.isFinite(state.matchRemainingSeconds)?state.matchRemainingSeconds:soccer&&Number.isFinite(state.soccerMinute)&&state.soccerMinute<90?Math.max(0,(90-state.soccerMinute)*60):!baseball&&!tennis&&!soccer&&Number.isFinite(state.remainingSeconds)?state.remainingSeconds:null):null;
      const clockSeconds=storedClockSeconds(preciseClockSeconds,state.clockRunning);
      const clockLabel=state.golf?'Round progress':/esports/.test(state.type)?'Match phase':/cricket/.test(state.type)?'Innings progress':soccer?Number.isFinite(state.matchRemainingSeconds)?'Match time left':state.soccerMinute>=90?'Stoppage time':'Regulation left':baseball?'Inning progress':tennis?'Set progress':['NCAAB','NCAAW'].includes(state.sport)? `Half ${state.period||'?'} left`:/hockey/.test(state.type)?`Period ${state.period||'?'} left`:/football|basketball/.test(state.type)?`Quarter ${state.period||'?'} left`:'Game clock';
      const displayClockLabel=clockSeconds!=null&&state.clockRunning===false?`${clockLabel} · paused`:clockLabel;
      snapshotRows.set(state.id,[state.id,state.title||'Sports game',state.sport,state.type,state.scoreKnown?state.home:null,state.scoreKnown?state.away:null,state.verifiedLive?'live':/^(final|finished|complete|completed|closed|ended)$/.test(state.status)?'final':'inactive',Number.isFinite(state.progress)?state.progress:null,String(state.period||''),timeLeft,clockSeconds,displayClockLabel,liveMap.get(milestone.id)?._observed_at||null,scanStarted,'[]',state.possessionSide,state.homeTeamId||null,state.awayTeamId||null ]);
      snapshotRows.get(state.id).valueSignals=valueSignals;
    }
    const missing=[...allCandidates,...upgradeCandidates].filter(c=>!hasAsk(c.market));
    if(missing.length){
      const quotes=await bestAsksForTickers(missing.map(c=>c.market.ticker),async tickers=>{
        const q=new URLSearchParams();tickers.forEach(ticker=>q.append('tickers',ticker));
        return (await kalshi('/markets/orderbooks?'+q)).orderbooks;
      },async ticker=>({ticker,orderbook_fp:(await kalshi('/markets/'+encodeURIComponent(ticker)+'/orderbook')).orderbook_fp}),
      (ticker,error)=>console.warn('Ask depth probe unavailable:',ticker,error.message));
      for(const c of missing){const quote=quotes.get(c.market.ticker);
        if(quote)c.market={...c.market,yes_ask_dollars:quote.price.toFixed(4),yes_ask_size_fp:quote.size.toFixed(2)};
      }
    }
    for(let i=0;i<allCandidates.length;i+=100){const batch=allCandidates.slice(i,i+100);if(!batch.length)continue;
      const values=batch.map((_,n)=>`($${2*n+1},$${2*n+2})`).join(',');
      await pool.query(`INSERT INTO candidate_windows(market_ticker,strategy) VALUES ${values} ON CONFLICT DO NOTHING`,batch.flatMap(c=>[c.market.ticker,c.signal.strategy]));
    }
    for(const [id,candidates] of snapshotCandidates){
      snapshotRows.get(id)[14]=JSON.stringify(candidates.map(c=>({strategy:c.signal.strategy,reason:c.signal.reason,ticker:c.market.ticker,title:c.market.title||c.market.yes_sub_title||'',ask:c.market.yes_ask_dollars,ask_size:c.market.yes_ask_size_fp,execution:signalExecution(c,filled,account,balance,bankroll)})));
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
      // A concurrent clock refresh may be newer than the scan's clock. Keep
      // that clock, but always publish this scan's signal set and its own age.
      const signalValues=batch.map((_,row)=>`($${row*2+1},$${row*2+2})`).join(',');
      await pool.query(`UPDATE game_snapshots AS g SET signals=v.signals::jsonb,scanned_at=clock_timestamp()
        FROM (VALUES ${signalValues}) AS v(id,signals) WHERE g.id=v.id`,batch.flatMap(row=>[row[0],row[14]]));
      await pool.query(`UPDATE game_snapshots AS g SET value_signals=v.value_signals::jsonb
        FROM (VALUES ${signalValues}) AS v(id,value_signals) WHERE g.id=v.id`,batch.flatMap(row=>[row[0],JSON.stringify(row.valueSignals||[])]));
    }
    for(let i=0;i<valueObservations.length;i+=50){
      const batch=valueObservations.slice(i,i+50);
      const values=batch.map((_,row)=>'('+Array.from({length:8},(_,field)=>'$'+(row*8+field+1)).join(',')+')').join(',');
      await pool.query(`INSERT INTO value_scan_observations
        (observed_at,game_id,market_ticker,role,ask,ask_size,game_state,market_rules)
        VALUES ${values} ON CONFLICT DO NOTHING`,batch.flatMap(({gameId,value,state,market})=>[
          scanStarted,gameId,value.ticker,value.role,value.ask,value.size,
          JSON.stringify({sport:state.sport,type:state.type,home:state.home,away:state.away,period:state.period,remainingSeconds:state.remainingSeconds,
            matchRemainingSeconds:state.matchRemainingSeconds,possessionSide:state.possessionSide,
            gameObservedAt:state.observedAt,gameUpdatedAt:state.updatedAt}),String(market.rules_primary||'')
        ]));
    }
    // Make the live score and clock visible before slower order preflights.
    await pool.query(`UPDATE scan_status SET last_scan=$1,scanned=$2,signals=$3,discovered=$4 WHERE id=1`,[scanStarted,scanned,signals,discoveryCount]);
    // Verify held fallbacks and process singles before waiting for maker RFQs.
    opportunities.sort((a,b)=>{
      const executable=c=>hasAsk(c.market)&&!filled.has(signalKey(c))&&profitableCount(executableCount(c,balance,bankroll),Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market),c.signal.strategy,bankroll,c.state.type,c.state.remainingSeconds)>0;
      if(executable(a)!==executable(b))return executable(a)?-1:1;
      if(a.signal.strategy!==b.signal.strategy)return a.signal.strategy==='over'?-1:1;
      const profit=c=>netSettlementProfitCents(executableCount(c,balance,bankroll),Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
      return profit(b)-profit(a) || (a.signal.strategy==='lead'?Number(tieRefundPreference(b.market))-Number(tieRefundPreference(a.market)):0);
    });
    // Each order has its own fraction of the full bankroll. Cash availability
    // and the current quote remain separate execution gates.
    // Verify independent over scoreboards in parallel. A dozen sequential 12s
    // dwells used to freeze the dashboard for minutes and miss later games.
    const overPreflights=new Map(),overReady=new Map(),overs=live()?
      [...opportunities.filter(c=>hasAsk(c.market)),...upgradeCandidates].filter(c=>c.signal.strategy==='over'):[];
    for(const c of overs)overReady.set(signalKey(c),new Promise(resolve=>{c.preflightDone=resolve}));
    let cursor=0;
    const workersDone=Promise.all(Array.from({length:Math.min(20,overs.length)},async()=>{
      while(cursor<overs.length){const c=overs[cursor++];
        try{
          // Independent scoreboard verification begins with the first Kalshi
          // score; only the Kalshi-only fallback needs the ten-second dwell.
          const independentFirst=auditedOver(c.state,c.milestone,{cache:scoreboardCache,market:c.market,allowUnavailable:true}).catch(()=>false);
          const firstDecision=await independentFirst;
          if(firstDecision===false||c.upgradeFill&&firstDecision!==true)continue;
          if(firstDecision===null&&/soccer/.test(c.state.type))continue;
          const remaining=firstDecision===true?0:Math.max(0,VERIFY_DWELL_MS-(Date.now()-c.state.observedAt));
          if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
          const latest=await liveMilestone(c.milestone.id);
          if(!latest)continue;
          latest._observed_at=new Date().toISOString();
          const state=gameState(c.milestone,latest);
          if(!confirmedOver(c.state,state,c.market,firstDecision===true?0:VERIFY_DWELL_MS))continue;
          if(firstDecision===true){
            state.verificationId=c.state.verificationId;
            state.lastScoringPlay=c.state.lastScoringPlay;
            overPreflights.set(signalKey(c),{state,kalshiOnly:false});
          }else{
            const secondDecision=await auditedOver(state,c.milestone,{market:c.market,firstObservation:c.state,allowUnavailable:true});
            if(secondDecision===true)overPreflights.set(signalKey(c),{state,kalshiOnly:false});
            else if(secondDecision===null&&await auditKalshiOnlyOver(c.state,state,c.market,c.milestone))
              overPreflights.set(signalKey(c),{state,kalshiOnly:true});
          }
        }catch(e){console.warn('Over preflight deferred:',c.market.ticker,e.message)}
        finally{c.preflightDone()}
      }
    }));
    const heldLeads=upgradeCandidates.filter(c=>c.signal.strategy==='lead');
    const leadReady=new Map(heldLeads.map(c=>[signalKey(c),new Promise(resolve=>{c.leadDone=resolve})]));
    let leadCursor=0;
    const leadWorkers=Promise.all(Array.from({length:Math.min(12,heldLeads.length)},async()=>{
      while(leadCursor<heldLeads.length){const c=heldLeads[leadCursor++];
        try{c.leadVerified=await verifyHeldLead(c,c.upgradeFill,scoreboardCache)}
        catch(e){c.leadVerified=false;console.warn('Held lead verification deferred:',c.market.ticker,e.message)}
        finally{c.leadDone()}
      }
    }));
    const immediateUpgradeJobs=[];
    for(const c of [...opportunities,...upgradeCandidates]){let state=c.state;
      try{
        if(!live())continue;
        if(c.upgradeFill){
          if(overReady.has(signalKey(c)))await overReady.get(signalKey(c));
          if(leadReady.has(signalKey(c)))await leadReady.get(signalKey(c));
          const result=c.signal.strategy==='over'?await upgradeHeldOver(c,overPreflights.get(signalKey(c)),c.upgradeFill,scoreboardCache):
            {verified:c.leadVerified===true,filled:false};
          if(result.filled){submitted++;const current=await accountBalance({fresh:true});balance=Number(current.balance);bankroll=balance+Number(current.portfolio_value)}
          continue;
        }
        if(balance<=0)break;
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
        const spendable=balance;
        // A confirmed over preflight expires quickly; never submit on a stale
        // score. Lead games still require a fresh check before the quote.
        if(c.signal.strategy==='over'&&overReady.has(signalKey(c)))await overReady.get(signalKey(c));
        const preflight=c.signal.strategy==='over'?overPreflights.get(signalKey(c)):null;
        if(c.signal.strategy==='over'&&/soccer/.test(c.state.type)&&preflight?.kalshiOnly!==false)continue;
        let kalshiOnly=preflight?.kalshiOnly===true;
        let freshState=c.signal.strategy==='over'?preflight?.state:
          gameState(c.milestone,(await liveBatch([c.milestone])).get(c.milestone.id));
        if(!freshState)continue;
        if(c.signal.strategy==='over'&&Date.now()-freshState.observedAt>10000){
          const remaining=kalshiOnly?VERIFY_DWELL_MS-(Date.now()-freshState.observedAt):0;
          if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
          const next=await liveMilestone(c.milestone.id);
          if(!next)continue;
          next._observed_at=new Date().toISOString();const rechecked=gameState(c.milestone,next);
          if(!confirmedOver(freshState,rechecked,c.market,kalshiOnly?VERIFY_DWELL_MS:0))continue;
          const decision=await auditedOver(rechecked,c.milestone,{market:c.market,firstObservation:freshState,allowUnavailable:true});
          if(decision===false||decision===null&&(!kalshiOnly||!await auditKalshiOnlyOver(freshState,rechecked,c.market,c.milestone)))continue;
          if(decision===true)kalshiOnly=false;
          freshState=rechecked;
        }
        if(c.signal.strategy==='lead' && /basketball/.test(state.type) &&
          (freshState.period!==state.period || !freshState.periodConsistent ||
            freshState.remainingSeconds>state.remainingSeconds))continue;
        let leadFirstDecision=null,leadSecondDecision=null;
        if(c.signal.strategy==='lead'&&!freshState.golf){
          leadFirstDecision=tableTennisSignal(c.state,c.market)?
            await verifyIndependentTableTennisLeadDecision(c.state,c.milestone):
            await auditedOver(c.state,c.milestone,{cache:scoreboardCache,market:c.market,allowUnavailable:true});
          if(leadFirstDecision===false)continue;
        }
        if(c.signal.strategy==='lead'){
          const wait=leadFirstDecision===true?0:VERIFY_DWELL_MS-(Date.now()-c.state.observedAt);
          if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
          const second=await liveMilestone(c.milestone.id);
          if(!second)continue;
          second._observed_at=new Date().toISOString();
          const checked=gameState(c.milestone,second);
          if(!checked.verifiedLive||checked.feedId!==c.milestone.id||
             !Number.isFinite(c.state.observedAt)||checked.observedAt-c.state.observedAt<(leadFirstDecision===true?1:VERIFY_DWELL_MS)||
             Number.isFinite(c.state.updatedAt)&&Number.isFinite(checked.updatedAt)&&checked.updatedAt<c.state.updatedAt||
             checked.home!==c.state.home||checked.away!==c.state.away||
             !confirmedSoccerOneGoalClock(c.state,checked)||!confirmedDrawClock(c.state,checked,c.market))continue;
          freshState=checked;
        }
        const rawQuote=await recoverSummaryAsk((await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market,{fresh:true});
        const quote=rawQuote&&hasAsk(rawQuote)?await executableQuote(rawQuote):null;
        if(!quote){
          if(c.signal.strategy==='over'&&freshState.verificationId)
            await reportVerifiedGate(freshState,c.market.ticker,rawQuote&&hasAsk(rawQuote)?
              'Score verified; quoted YES shares disappeared from the live orderbook':
              'Score verified; no live YES ask remains',true);
          continue;
        }
        if(quote.ticker!==c.market.ticker||quote.event_ticker!==c.event.event_ticker||!hasAsk(quote))continue;
        if(quote.rules_primary!==c.market.rules_primary||quote.floor_strike!==c.market.floor_strike||
          quote.cap_strike!==c.market.cap_strike||quote.close_time!==c.market.close_time||
          JSON.stringify(quote.custom_strike||{})!==JSON.stringify(c.market.custom_strike||{}))continue;
        if(kalshiOnly&&(Date.now()-freshState.observedAt>10000||
          quote.rules_primary!==c.market.rules_primary||quote.floor_strike!==c.market.floor_strike||
          quote.cap_strike!==c.market.cap_strike||quote.close_time!==c.market.close_time))continue;
        const stillQualifies=c.signal.strategy==='over'?overSignal(freshState,quote):golfSignal(freshState,quote)||leadSignal(freshState,quote)||additionalLeadSignal(freshState,quote)||cricketLeadSignal(freshState,quote)||drawSignal(freshState,quote)||earlyLeadSignal(freshState,quote)||tennisSignal(freshState,quote)||tableTennisSignal(freshState,quote);
        if(!stillQualifies)continue;
        if(freshState.golf&&!await verifyGolf(freshState,c.milestone,c.event))continue;
        if(c.signal.strategy==='lead'&&!freshState.golf){
          const decision=leadFirstDecision===true?true:tableTennisSignal(freshState,quote)?
            await verifyIndependentTableTennisLeadDecision(freshState,c.milestone):
            await auditedOver(freshState,c.milestone,{market:quote,firstObservation:c.state,allowUnavailable:true});
          leadSecondDecision=decision;
          if(decision===false)continue;
          if(decision===null){
            if(leadFirstDecision!==null||Date.now()-freshState.observedAt>10000||
              quote.rules_primary!==c.market.rules_primary||quote.close_time!==c.market.close_time||
              quote.floor_strike!==c.market.floor_strike||quote.cap_strike!==c.market.cap_strike||
              JSON.stringify(quote.custom_strike||{})!==JSON.stringify(c.market.custom_strike||{})||
              !await auditKalshiOnlyLead(c.state,freshState,quote,c.milestone))continue;
            kalshiOnly=true;
          }
        }
        if(!soccerOneGoalWindowOpen(freshState))continue;
        const verifiedSignal=externallyVerifiedEarlySoccerLead(c.state,freshState,stillQualifies,
          leadFirstDecision===true,leadSecondDecision===true);
        const verifiedFraction=stableSoccerLeadFraction(c.state,freshState,verifiedSignal);
        const oneGoalSoccer=/soccer/.test(freshState.type)&&Math.abs(freshState.home-freshState.away)===1;
        const specificCap=Boolean(tennisSignal(freshState,quote)||cricketLeadSignal(freshState,quote)||drawSignal(freshState,quote));
        c.signal=kalshiOnly?{...verifiedSignal,fraction:oneGoalSoccer||specificCap?verifiedFraction:Math.min(verifiedFraction,KALSHI_ONLY_FRACTION),reason:verifiedSignal.reason+'; Kalshi-only two score reads, 10 seconds apart'}:
          {...verifiedSignal,fraction:verifiedFraction};
        c.market=quote;
        c.state=state=freshState;
        const budget=Infinity;
        const wanted=executableCount(c,spendable,bankroll);
        if(!wanted){
          if(c.signal.strategy==='over'&&freshState.verificationId)
            await reportVerifiedGate(freshState,c.market.ticker,'Score verified; current ask, fees or available cash do not allow a profitable order');
          continue;
        }
        const shard=marketShard(c.event,c.market),localCash=shardCash(latest,shard);
        if(localCash===null){executionErrors.push(`${c.market.ticker}: Kalshi shard balance unavailable`);continue}
        if(!soccerOneGoalWindowOpen(state))continue;
        if(['check_order','reserved','retrying'].includes(prior.rows[0]?.status)){
          await recoverPending(c.signal,state,c.event,c.market,Math.min(spendable,localCash),bankroll,budget,bankroll);
          continue;
        }
        if(prior.rows[0]?.status==='needs_review')continue;
        const desiredCost=estimatedCostCents(wanted,Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
        if(localCash<desiredCost&&transferPlan(latest,shard,desiredCost)){
          await ensureShardFunding(c.signal,c.event,c.market,latest,desiredCost);
        }
        // The allocation is a ceiling. Buy the profitable quantity already
        // affordable in this shard while any top-up settles asynchronously.
        if(!soccerOneGoalWindowOpen(state))continue;
        if(await submit(c.signal,state,c.event,c.market,Math.min(spendable,localCash),bankroll,budget,bankroll)||await recoverPending(c.signal,state,c.event,c.market,Math.min(spendable,localCash),bankroll,budget,bankroll)){
          submitted++;filled.add(signalKey(c));
          if(c.signal.strategy==='over'&&kalshiOnly)immediateUpgradeJobs.push(immediatelyUpgradeFilledOver(c,scoreboardCache)
            .then(upgraded=>{if(upgraded)submitted++})
            .catch(e=>console.warn('Immediate over verification deferred:',c.market.ticker,e.message)));
          const account=await accountBalance({fresh:true});balance=Number(account.balance);bankroll=balance+Number(account.portfolio_value);
        }
      }catch(e){const message=`${c.market.ticker}: ${String(e.message).slice(0,170)}`;executionErrors.push(message);console.error('Candidate execution failed:',message)}
    }
    await Promise.all([workersDone,leadWorkers,...immediateUpgradeJobs]);
    if(live()){
      try{
        const combo=await comboJob;
        if(combo.error)executionErrors.push('Combo: '+String(combo.error).slice(0,180));
        if(combo.filled)submitted++;
        if(await upgradeVerifiedCombos(scanStarted))submitted++;
      }catch(e){executionErrors.push('Combo: '+String(e.message).slice(0,180));console.error('Post-fill combo execution deferred:',e)}
    }
    if(live()){
      try{await diagnoseHeldCombinations(existingFills.rows,openPositions)}catch(e){console.warn('Held combo diagnostic deferred:',e.message)}
      try{await diagnoseUnfilledCombo(opportunities,filled)}catch(e){console.warn('Unfilled combo diagnostic deferred:',e.message)}
    }
    await pool.query('UPDATE scan_status SET last_scan=$5,last_error=$4,scanned=$1,signals=$2,discovered=$6,orders_submitted=orders_submitted+$3 WHERE id=1',[scanned,signals,submitted,executionErrors.length?executionErrors.slice(0,2).join('; ').slice(0,250):null,scanStarted,discoveryCount]);
    try{await syncSettlementAlerts()}catch(e){console.error('Settlement alert scan failed:',e)}
    return {scanned,signals,submitted,active:active.length,discovered:discoveryCount,next:games.filter(g=>g.state.verifiedLive || (new Date(g.milestone.start_date).getTime()>Date.now()-3600000 && new Date(g.milestone.start_date).getTime()<Date.now()+3600000)).map(g=>g.milestone)};
  }catch(e){console.error('Scan failed:',e);await pool.query('UPDATE scan_status SET last_scan=now(),last_error=$1,scanned=$2,signals=$3 WHERE id=1',[String(e.message).slice(0,250),scanned,signals]);return {error:e.message,scanned,signals,next:ms}}
  finally{await client.query('ROLLBACK');client.release()}
}
async function refreshOpenClocks(){
  // Only the dashboard visitor requests this five-second refresh; the scanner
  // can spend longer evaluating orders without freezing the visible game clock.
  await ensureScoreTime();
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
      const label=s.golf?'Round progress':/esports/.test(s.type)?'Match phase':/cricket/.test(s.type)?'Innings progress':soccer?'Regulation left':baseball?'Inning progress':tennis?'Set progress':['NCAAB','NCAAW'].includes(s.sport)?`Half ${s.period||'?'} left`:/hockey/.test(s.type)?`Period ${s.period||'?'} left`:/football|basketball/.test(s.type)?`Quarter ${s.period||'?'} left`:'Game clock';
      await pool.query(`UPDATE game_snapshots SET home=$2,away=$3,status=$4,time_left=$5,possession_side=$9,score_observed_at=clock_timestamp(),
        clock_observed_at=CASE WHEN clock_seconds IS DISTINCT FROM $6::integer OR period IS DISTINCT FROM $8::text OR status IS DISTINCT FROM $4::text
          THEN clock_timestamp() ELSE clock_observed_at END,
        clock_seconds=$6,clock_label=$7,period=$8
        WHERE id=$1 AND (scanned_at<clock_timestamp() OR status='live')
          AND (status IS DISTINCT FROM 'live' OR $4::text IS DISTINCT FROM 'live' OR period IS DISTINCT FROM $8::text OR clock_seconds IS NULL OR $6::integer IS NULL OR $6::integer<=clock_seconds)`,
        [m.id,s.scoreKnown?s.home:null,s.scoreKnown?s.away:null,s.verifiedLive?'live':'final',
          gameTimeLabel(s),storedClockSeconds(seconds,s.clockRunning),s.clockRunning===false?`${label} · paused`:label,String(s.period||''),s.possessionSide]);
    }));
  }catch(e){console.warn('Dashboard clock refresh deferred:',e.message)}
}
let recentDashboardPositions=null,recentDashboardBalance=null;
const dashboardDeadline=ms=>new Promise(resolve=>setTimeout(()=>resolve(null),ms));
async function state(){
  await ensureScoreTime();
  await ensureValueScan();
  await pool.query(`CREATE TABLE IF NOT EXISTS combo_diagnostics (id bigserial PRIMARY KEY,
    checked_at timestamptz NOT NULL DEFAULT now(),leg_tickers jsonb NOT NULL,
    collection_ticker text,status text NOT NULL,detail text)`);
  const [snap,stats,attempts,weatherStatus]=await Promise.all([
  pool.query(`SELECT id,title,sport,home,away,possession_side,status,time_left,scanned_at,signals,value_signals FROM game_snapshots
    WHERE status IN ('live','inprogress','started') AND scanned_at>now()-interval '15 minutes'
    ORDER BY jsonb_array_length(signals) DESC,title`),
  pool.query('SELECT * FROM scan_status WHERE id=1'),
  pool.query(`SELECT a.market_ticker,a.game_id,a.sport,a.strategy,a.reason,a.combo_legs,a.fill_count,a.limit_price,g.status AS game_status,g.title AS game_title,g.sport_family,g.possession_side,g.home AS home_score,g.away AS away_score,GREATEST(g.score_observed_at,g.scanned_at) AS score_scanned_at,g.clock_seconds,g.clock_label,g.clock_observed_at,g.time_left FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id WHERE a.status='filled' ORDER BY a.created_at DESC`),
  pool.query('SELECT * FROM weather_scan_status WHERE id=1')
]);
  for(const game of snap.rows){
    game.stale=new Date(game.scanned_at).getTime()<new Date(stats.rows[0]?.last_scan||0).getTime()-2000 ||
      Date.now()-new Date(game.scanned_at).getTime()>30000;
    if(game.stale)for(const signal of game.signals||[])signal.execution='Rechecking live game; last status: '+signal.execution;
  }
  const awaiting=[...new Set(snap.rows.flatMap(g=>(g.signals||[]).filter(s=>s.execution==='Awaiting score verification').map(s=>s.ticker)))];
  if(awaiting.length){
    const {rows}=await pool.query(`SELECT DISTINCT ON (market_ticker) market_ticker,passed,created_at,evidence->>'mode' AS mode,
      evidence->>'independentUnavailable' AS independent_unavailable,
      evidence->'game'->>'verificationIssue' AS verification_issue
      FROM verification_records WHERE market_ticker=ANY($1) AND created_at>now()-interval '5 minutes'
      ORDER BY market_ticker,created_at DESC`,[awaiting]);
    const checked=new Map(rows.map(r=>[r.market_ticker,r]));
    for(const game of snap.rows)for(const signal of game.signals||[]){
      const result=checked.get(signal.ticker);
      if(signal.execution==='Awaiting score verification'&&result&&new Date(result.created_at).getTime()>=new Date(game.scanned_at).getTime()){
        signal.execution=verificationStatus(result);
        signal.verification_checked_at=result.created_at;
      }
    }
  }
  let balance=null,positions=null,accountError=null,positionsError=null;
  if(configured()){
    await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_positions_cache (
      id integer PRIMARY KEY,positions jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);
    const [balanceResult,positionsResult]=await Promise.allSettled([
      Promise.race([accountBalance().then(value=>(recentDashboardBalance=value)),dashboardDeadline(4000)]),
      Promise.race([allOpenPositions().then(value=>{
        recentDashboardPositions={value,at:Date.now()};
        void pool.query(`INSERT INTO dashboard_positions_cache(id,positions,updated_at) VALUES(1,$1,now())
          ON CONFLICT(id) DO UPDATE SET positions=EXCLUDED.positions,updated_at=now()`,[JSON.stringify(value)]).catch(e=>console.warn('Dashboard position cache deferred:',e.message));
        return value;
      }),dashboardDeadline(4000)])
    ]);
    if(balanceResult.status==='fulfilled'){
      const value=balanceResult.value||recentDashboardBalance;
      if(value&&Number.isFinite(Number(value.balance))&&Number.isFinite(Number(value.portfolio_value)))balance=value;
      else accountError=balanceResult.value?'Kalshi returned an incomplete balance response':'Live balance is taking longer than usual; retrying';
    }else accountError=String(balanceResult.reason?.message||balanceResult.reason);
    if(positionsResult.status==='fulfilled')positions=positionsResult.value||
      (recentDashboardPositions&&Date.now()-recentDashboardPositions.at<60000?recentDashboardPositions.value:null);
    else positionsError=String(positionsResult.reason?.message||positionsResult.reason);
    if(positions&&!positionsResult.value)positionsError='Live positions delayed; showing recent holdings';
    if(!positions){
      const {rows}=await pool.query(`SELECT positions FROM dashboard_positions_cache
        WHERE id=1 AND updated_at>now()-interval '90 seconds'`);
      if(rows.length){positions=rows[0].positions;positionsError='Live positions delayed; showing recent holdings';}
      else if(!positionsError)positionsError='Live positions are taking longer than usual; retrying';
    }
  }else accountError='Kalshi credentials are missing from the Neon function environment';
  const open=new Set((positions?.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
  const {rows:comboIssues}=await pool.query(`SELECT checked_at,leg_tickers,status,detail FROM combo_diagnostics
    WHERE status IN ('no_compatible_collection','no_executable_quote','insufficient_cash') AND checked_at>now()-interval '10 minutes'
    ORDER BY checked_at DESC LIMIT 20`);
  const orders=positions?attempts.rows.filter(o=>open.has(o.market_ticker)).map(o=>{
    const position=(positions.market_positions||[]).find(p=>p.ticker===o.market_ticker);
    const count=Number(position?.position_fp||0);
    const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
    const actual=position?.market_exposure_dollars!=null&&position?.fees_paid_dollars!=null&&
      Number.isFinite(exposure)&&Number.isFinite(fees);
    const allocated=actual?Math.ceil(exposure*100)+Math.ceil(fees*100):Math.ceil(count*Number(o.limit_price)*100);
    return {...o,position,fill_count:count,allocated_cents:allocated,
      potential_profit_cents:actual?Math.floor(count*100-allocated):netSettlementProfitCents(count,Number(o.limit_price),2)};
  }).sort((a,b)=>b.potential_profit_cents-a.potential_profit_cents):[];
  for(const o of orders){
    o.selected_name=o.strategy==='lead'?String(o.reason||'').match(/(?:^|: )([^;:]+?) leads \d/i)?.[1]||null:
      String(o.reason||'').match(/\bby ([^;]+);/)?.[1]||null;
    delete o.position;
  }
  const comboIssue=comboIssues.find(issue=>!(issue.status==='insufficient_cash'&&Number(balance?.balance)>=100)&&issue.leg_tickers.length>=2&&
    issue.leg_tickers.every(ticker=>open.has(ticker)))||null;
  if(comboIssue)comboIssue.leg_names=comboIssue.leg_tickers.map(ticker=>orders.find(o=>o.market_ticker===ticker)?.game_title||ticker);
  return {live:live(),exitOnly:exitOnly(),credentials:configured(),aiConfigured:Boolean(process.env.AI_API_KEY),balance,accountError,positionsError,positionsStale:Boolean(positions&&positionsError),games:snap.rows,scan:stats.rows[0],weather:weatherStatus.rows[0],comboIssue,orders};
}
async function settlementAlerts(since){
  const {rows}=await pool.query(`SELECT id,ticker,profit_cents,settled_time,created_at FROM settlement_alerts WHERE id>$1 AND created_at>now()-interval '2 days' ORDER BY id LIMIT 50`,[since]);
  return rows;
}
export default {async fetch(req){const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname==='/health')return json({ok:true,live:live(),exitOnly:exitOnly(),credentials:configured(),tradingSwitch:process.env.LIVE_TRADING==='true'?'on':'off',revision:'robust-over-strict-weather-20261030'});
  if(req.method==='GET'&&url.pathname==='/manifest.webmanifest')return response(manifest,'application/manifest+json');
  if(req.method==='GET'&&url.pathname==='/sw.js')return new Response(worker,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','service-worker-allowed':'/','x-content-type-options':'nosniff'}});
  if(req.method==='GET'&&/^\/icon-(192|512)\.png$/.test(url.pathname))return response(Buffer.from(icons[Number(url.pathname.match(/\d+/)[0])],'base64'),'image/png');
  if(req.method==='POST'&&url.pathname==='/tick'){
    if(!req.headers.get('x-neon-trigger-invocation-id'))return json({error:'Forbidden'},403);
    const weatherClaim=await pool.query(`UPDATE weather_scan_status SET last_scan=now() WHERE id=1
      AND (last_scan IS NULL OR last_scan<now()-interval '90 seconds') RETURNING id`);
    const weatherJob=weatherClaim.rowCount?scanWeatherMarkets({kalshi,nws,twc,onVerified:executeVerifiedWeather}).then(async stats=>{
      console.info('Weather scan funnel:',JSON.stringify({series:stats.series,events:stats.events,eligible:stats.eligible,verified:stats.verified,companyProbe:stats.companyProbe,companyObservationFeed:stats.companyObservationFeed,sources:stats.sources,rejections:stats.rejections,thresholdSamples:stats.thresholdSamples}));
      await pool.query(`UPDATE weather_scan_status SET last_scan=now(),series=$1,events=$2,eligible=$3,verified=$4,failures=$5 WHERE id=1`,[stats.series,stats.events,stats.eligible,stats.verified,stats.failures]);
    }).catch(e=>console.warn('Weather discovery deferred:',e.message)):Promise.resolve();
    // Neon cron has minute resolution. Short invocations keep the three-second loop alive
    // without relying on one function instance surviving for a full quarter hour.
    const now=Date.now();const until=Math.min(now+55000,(Math.floor(now/60000)+1)*60000-2000);let cached=null,discoveryCount,cycles=0,last={};
    const correctionJob=watchCorrectedOvers(until).catch(e=>console.error('Fast correction watcher failed:',e));
    try{
      while(Date.now()<until){const begun=Date.now();last=await scan(cached,discoveryCount);cycles++;
        if(last.next)cached=last.next;if(last.discovered!=null)discoveryCount=last.discovered;
        if(last.error && !/Kalshi 429 /.test(last.error) || !last.error && !last.active)break;
        const pause=Math.max(0,3000-(Date.now()-begun));if(Date.now()+pause>=until)break;
        await new Promise(resolve=>setTimeout(resolve,pause));
      }
    }finally{await correctionJob}
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
    if(req.method==='POST'&&url.pathname==='/api/push-test'){
      if(req.headers.get('origin')!==url.origin||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Forbidden'},403);
      const raw=await req.text();if(raw.length>4096)return json({error:'Subscription too large'},413);
      let subscription;try{subscription=validateSubscription(JSON.parse(raw))}catch{return json({error:'Invalid subscription'},400)}
      const registered=await pool.query('SELECT subscription FROM push_subscriptions WHERE endpoint=$1',[subscription.endpoint]);
      if(!registered.rowCount)return json({error:'This device is not subscribed'},404);
      const code=await deliverPush(registered.rows[0].subscription,{type:'test-notification',id:'test',body:'Your K notifications are ready.'},pushIdentity());
      if(code===404||code===410){await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[subscription.endpoint]);return json({error:'Push subscription expired; tap the bell to subscribe again'},410)}
      return code===201||code===202?json({ok:true}):json({error:`Push provider rejected delivery (${code})`},502);
    }
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const since=Number(url.searchParams.get('since'))||0;
      if(!Number.isFinite(since)||since<0)return json({error:'Invalid cursor'},400);
      // A live-feed refresh can outlast the browser's 12-second state timeout.
      // Allow a short update, then return the cached snapshot while it finishes.
      await Promise.race([refreshOpenClocks().catch(e=>console.warn('Dashboard clock refresh deferred:',e.message)),
        new Promise(resolve=>setTimeout(resolve,1500))]);
      const [snapshot,alerts]=await Promise.all([state(),settlementAlerts(since).catch(e=>{console.error('Dashboard alerts unavailable:',e);return null})]);
      return json({...snapshot,alerts});
    }
    if(req.method==='GET'&&url.pathname==='/api/sell-quotes'){
      const tickers=[...new Set(url.searchParams.getAll('ticker'))];
      if(!tickers.length||tickers.length>20||tickers.some(t=>!/^[A-Z0-9-]{1,180}$/.test(t)))return json({error:'Invalid tickers'},400);
      const positions=await allOpenPositions();
      const held=new Map((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0).map(p=>[p.ticker,p]));
      const {rows}=await pool.query('SELECT DISTINCT ON (market_ticker) market_ticker,strategy,reason,limit_price FROM trade_attempts WHERE status=$1 AND market_ticker=ANY($2::text[]) ORDER BY market_ticker,created_at DESC',['filled',tickers]);
      const attempts=new Map(rows.map(o=>[o.market_ticker,o]));
      const results=await Promise.allSettled(tickers.filter(t=>held.has(t)&&attempts.has(t)&&attempts.get(t).strategy!=='over').map(async ticker=>{
        const {quote,market}=await currentSell(ticker,positions,true),attempt=attempts.get(ticker);
        return {ticker,sell_quote:quote,sell_profit_cents:quote?estimatedSaleProfitCents(held.get(ticker),quote,attempt.limit_price):null,
          selected_name:attempt.strategy==='lead'?market?.yes_sub_title||String(market?.title||'').replace(/\s+wins?\b.*/i,''):
            String(attempt.reason||'').match(/\bby ([^;]+);/)?.[1]||null};
      }));
      return json({quotes:results.filter(r=>r.status==='fulfilled').map(r=>r.value)});
    }
    if(req.method==='GET'&&url.pathname==='/api/history'){
      const beforeTime=url.searchParams.get('before_time'),beforeId=url.searchParams.get('before_id');
      const filter=url.searchParams.get('filter')||'all';
      if(!['all','profit','loss'].includes(filter))return json({error:'Invalid history filter'},400);
      if(Boolean(beforeTime)!==Boolean(beforeId)||beforeTime&&(!Number.isFinite(new Date(beforeTime).getTime())||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(beforeId)))return json({error:'Invalid history cursor'},400);
      const [{rows},{rows:[summary]}]=await Promise.all([
        pool.query(`SELECT id,sport,teams,occurred_at,profit_cents FROM trade_history
          WHERE ($1::timestamptz IS NULL OR (occurred_at,id)<($1::timestamptz,$2::uuid))
            AND ($3::text='all' OR $3::text='profit' AND profit_cents>0 OR $3::text='loss' AND profit_cents<0)
          ORDER BY occurred_at DESC,id DESC LIMIT 51`,[beforeTime||null,beforeId||null,filter]),
        pool.query(`SELECT count(*) FILTER (WHERE profit_cents>0) AS profit_count,
          count(*) FILTER (WHERE profit_cents<0) AS loss_count,
          COALESCE(sum(profit_cents) FILTER (WHERE profit_cents>0),0) AS profit_cents,
          COALESCE(sum(profit_cents) FILTER (WHERE profit_cents<0),0) AS loss_cents
          FROM trade_history`)
      ]);
      const history=rows.slice(0,50),last=history.at(-1);
      return json({history:history.map(({sport,teams,occurred_at,profit_cents})=>({sport,teams,occurred_at,profit_cents})),summary,next:rows.length>50?{before_time:last.occurred_at,before_id:last.id}:null});
    }
    if(req.method==='GET'&&url.pathname==='/history')return new Response(historyPage,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
    if(req.method==='GET'&&url.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}})
  }catch(e){console.error(e);return json({error:'Service unavailable'},503)}
  return json({error:'Not found'},404);
}};

