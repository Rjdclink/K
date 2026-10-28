import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { page } from './ui.mjs';
import { gameState, overSignal, leadSignal, tennisSignal, orderSize, estimatedCostCents, overBudget, profitableCount, netSettlementProfitCents, comeback } from './strategy.mjs';
import { reviewMiss } from './ai.mjs';
import { kalshiSignature } from './auth.mjs';
import { marketShard, shardCash, transferPlan } from './funding.mjs';
import { icons } from './icons.mjs';
import { manifest, worker } from './pwa.mjs';
import { vapidIdentity, validateSubscription, deliverPush } from './push.mjs';
import { favorableSettlement } from './settlements.mjs';
import { authorized, checkCredentials, sessionCookie, loginPage } from './dashboard_auth.mjs';

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
async function kalshi(path,opts={}){
  const method=opts.method||'GET';const headers={'accept':'application/json'};
  if(opts.auth){const {key,privateKey}=credentials();if(!key||!privateKey)throw Error('Kalshi credentials unavailable');const timestamp=String(Date.now());const unsignedPath='/trade-api/v2'+path.split('?')[0];const signature=kalshiSignature(privateKey,timestamp,method,unsignedPath);Object.assign(headers,{'KALSHI-ACCESS-KEY':key,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature})}
  if(opts.body)headers['content-type']='application/json';
  for(let attempt=0;;attempt++){
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
async function syncSettlementAlerts(){
  if(!configured())return;
  // A second scanner instance cannot poll and enqueue the same records simultaneously.
  const claim=await pool.query(`UPDATE settlement_poll SET last_check=now() WHERE id=1 AND last_check<now()-interval '30 seconds' RETURNING id`);
  if(!claim.rowCount)return;
  try{
    const held=await pool.query(`SELECT DISTINCT market_ticker FROM trade_attempts WHERE status='filled' AND created_at>now()-interval '14 days'`);
    const tickers=new Set(held.rows.map(r=>r.market_ticker));
    if(tickers.size){
      let cursor='';const minTs=Math.floor(Date.now()/1000)-48*3600;
      for(let pageNumber=0;pageNumber<5;pageNumber++){
        const query=new URLSearchParams({limit:'1000',min_ts:String(minTs)});if(cursor)query.set('cursor',cursor);
        const result=await kalshi('/portfolio/settlements?'+query,{auth:true});
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
  return found.filter(m=>m.id && new Date(m.start_date).getTime()<now+3600000 && (!m.end_date||new Date(m.end_date).getTime()>now-3600000));
}
async function liveBatch(ms){
  const map=new Map();for(let i=0;i<ms.length;i+=20){const group=ms.slice(i,i+20);const q=new URLSearchParams();group.forEach(m=>q.append('milestone_ids',m.id));
    let list=[];try{list=(await kalshi('/live_data/batch?'+q)).live_datas||[]}catch(e){
      if(!/^Kalshi (400|404|405) /.test(String(e.message)))throw e;
      console.warn('Live batch unsupported; using bounded individual requests:',e.message);
      for(const m of group){try{const result=await kalshi('/live_data/milestone/'+encodeURIComponent(m.id));if(result.live_data)list.push(result.live_data)}catch(error){if(/Kalshi 429 /.test(String(error.message)))throw error}}
    }
    const observedAt=new Date().toISOString();
    list.forEach(d=>map.set(d.milestone_id,{...d,_observed_at:observedAt}));}
  return map;
}
async function marketMap(tickers){
  const map=new Map();const list=[...new Set(tickers)].filter(Boolean);
  for(let i=0;i<list.length;i+=35){const q=new URLSearchParams({tickers:list.slice(i,i+35).join(','),with_nested_markets:'true',limit:'200',status:'open'});
    const result=await kalshi('/events?'+q);for(const e of result.events||[])map.set(e.event_ticker,e);
  }return map;
}
function linkedEventTickers(m){
  const original=m.related_event_tickers||[];
  const totals=original.map(t=>t.replace(/^([A-Z0-9]+)GAME(-.+)$/,'$1TOTAL$2')).filter((t,i)=>t!==original[i]);
  return [...new Set([...original,...totals])];
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
function contractCount(balance,market,fraction,bankroll,budget,fees){
  const count=orderSize(balance,market.yes_ask_dollars,market.yes_ask_size_fp,fraction,Number(process.env.MAX_YES_PRICE||1),bankroll,budget,fees);
  return market.fractional_trading_enabled===false?Math.floor(count):count;
}
function executableCount(c,balance,bankroll,overRemaining){
  const fees=feeReserve(c.event,c.market),price=Number(c.market.yes_ask_dollars);
  const count=contractCount(balance,c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
  return profitableCount(count,price,fees,c.signal.strategy,balance,c.state.type,c.state.remainingSeconds);
}
const signalKey=c=>`${c.market.ticker}:${c.signal.strategy}`;
function signalExecution(c,filled,account,balance,bankroll,overRemaining){
  if(filled.has(signalKey(c)))return 'Already filled';
  if(!hasAsk(c.market))return 'No ask liquidity';
  if(!account)return 'Trading paused';
  const price=Number(c.market.yes_ask_dollars),fees=feeReserve(c.event,c.market);
  const raw=contractCount(balance,c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
  if(!raw)return 'Insufficient budget or price above cap';
  if(!profitableCount(raw,price,fees,c.signal.strategy,balance,c.state.type,c.state.remainingSeconds))return 'Below minimum net profit after fees';
  const local=shardCash(account,marketShard(c.event,c.market));
  if(local===null)return 'Shard balance unavailable';
  if(local<estimatedCostCents(raw,price,fees)){
    if(transferPlan(account,marketShard(c.event,c.market),estimatedCostCents(raw,price,fees)))return 'Awaiting shard funding';
    const localCount=contractCount(Math.min(balance,local),c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
    if(!profitableCount(localCount,price,fees,c.signal.strategy,balance,c.state.type,c.state.remainingSeconds))return 'Insufficient shard cash';
  }
  return 'Eligible for submission';
}
async function ensureShardFunding(signal,event,market,account,desiredCents){
  const destination=marketShard(event,market);
  const plan=transferPlan(account,destination,desiredCents);
  if(!plan)return false;
  const {rows:[pending]}=await pool.query(`SELECT * FROM funding_transfers WHERE market_ticker=$1 AND strategy=$2 AND status IN ('pending','uncertain') ORDER BY created_at DESC LIMIT 1`,[market.ticker,signal.strategy]);
  if(pending){
    const history=await kalshi('/portfolio/intra_exchange_instance_transfers?limit=100',{auth:true});
    const matched=(history.transfers||[]).find(t=>t.client_transfer_id===pending.id);
    if(matched?.status==='complete'){
      await pool.query(`UPDATE funding_transfers SET status='complete',transfer_id=$2,updated_at=now() WHERE id=$1`,[pending.id,matched.transfer_id]);return false;
    }
    if(Date.now()-new Date(pending.updated_at).getTime()<15000)return false;
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
    if(match)await pool.query(`UPDATE funding_transfers SET status='complete',transfer_id=$2,updated_at=now() WHERE id=$1`,[row.id,match.transfer_id]);}
}
async function submit(signal,game,event,market,balance,bankroll,budgetCents=Infinity,availableCents=balance){
  const price=Number(market.yes_ask_dollars);const count=profitableCount(contractCount(balance,market,signal.fraction,bankroll,budgetCents,feeReserve(event,market)),price,feeReserve(event,market),signal.strategy,availableCents,game.type,game.remainingSeconds);if(!count)return false;
  const id=await reserve(signal,game,event,market,count,price,balance);if(!id)return false;
  try{
    // A partial IOC fill can be below the minimum net profit. Require the
    // entire quantity at the limit price or no entry at all.
    const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:market.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[id,Number(result.fill_count)>0?'filled':'unfilled',result.order_id||null,Number(result.fill_count||0)]);
    if(Number(result.fill_count)>0)await invalidateBalance();
    return Number(result.fill_count)>0;
  }catch(e){const terminal=/^Kalshi (400|401|403|404|422) /.test(String(e.message));await pool.query(`UPDATE trade_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,terminal?'rejected':'check_order',String(e.message).slice(0,250)]);console.error('Order needs reconciliation:',market.ticker,e.message);return false}
}
async function recoverPending(signal,game,event,market,balance,bankroll,budgetCents=Infinity,availableCents=balance){
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
async function exitComebacks(games,events,positions){
  const byGame=new Map(games.map(g=>[g.milestone.id,g.state]));
  const markets=new Map([...events.values()].flatMap(e=>(e.markets||[]).map(m=>[m.ticker,m])));
  const marketGames=new Map(games.flatMap(g=>linkedEventTickers(g.milestone).flatMap(t=>(events.get(t)?.markets||[]).map(m=>[m.ticker,g.milestone.id]))));
  const held=(positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)>0);
  if(!held.length)return;
  const recorded=await pool.query(`SELECT DISTINCT ON (market_ticker) market_ticker,game_id,strategy,status FROM trade_attempts WHERE status='filled' ORDER BY market_ticker,updated_at DESC`);
  const ownership=new Map(recorded.rows.map(r=>[r.market_ticker,r]));
  for(const position of held){
    const original=ownership.get(position.ticker),gameId=original?.game_id||marketGames.get(position.ticker),state=byGame.get(gameId),nested=markets.get(position.ticker);
    if(!state?.verifiedLive||!nested)continue;
    // Never auto-sell overs or positions without a verified lead entry.
    if(original?.strategy!=='lead'||/TOTAL/i.test(position.ticker))continue;
    const strategy='lead';
    if(!comeback(state,nested,strategy))continue;
    try{
      const market=(await kalshi('/markets/'+encodeURIComponent(position.ticker))).market;
      if(!market||!['active','open'].includes(market.status)||!comeback(state,market,strategy))continue;
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
async function scan(cachedMilestones){
  // A transaction-scoped lock is released by Postgres even if an invocation is terminated.
  // Snapshot writes use other pool connections so the dashboard sees each completed cycle.
  const client=await pool.connect();await client.query('BEGIN');
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(83027543) AS acquired');
  if(!lock.rows[0].acquired){await client.query('ROLLBACK');client.release();return {skipped:'scan in progress'}};
  let scanned=0,signals=0,submitted=0,ms;const executionErrors=[],scanStarted=new Date();let openPositions=null;
  try{
    if(live()&&!cachedMilestones)try{await reconcileFundingTransfers()}catch(e){console.warn('Transfer history unavailable:',e.message)}
    ms=cachedMilestones||await milestones();const liveMap=await liveBatch(ms);
    const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))}));
    const active=games.filter(g=>g.state.verifiedLive && g.state.scoreKnown);
    const events=await marketMap(active.flatMap(g=>linkedEventTickers(g.milestone)));
    let balance=0,bankroll=0,overRemaining=0,account=null;
    const existingFills=await pool.query(`SELECT market_ticker,strategy FROM trade_attempts WHERE status='filled'`);
    let filled=new Set(existingFills.rows.map(r=>`${r.market_ticker}:${r.strategy}`));
    if(live()||exitOnly()){
      const [currentAccount,positions,attempts]=await Promise.all([
        accountBalance(),
        allOpenPositions(),
        pool.query(`SELECT market_ticker,fill_count,limit_price FROM trade_attempts WHERE strategy='over' AND status='filled'`)
      ]);
      openPositions=positions;
      account=currentAccount;balance=Number(account.balance);
      bankroll=balance+Number(account.portfolio_value);
      const open=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
      const exposure=attempts.rows.reduce((sum,r)=>sum+(open.has(r.market_ticker)?Number(r.fill_count)*Number(r.limit_price)*100:0),0);
      overRemaining=overBudget(balance,account.portfolio_value,exposure);
    }
    // Exits are assessed before any new risk is added.
    if(live()||exitOnly())await exitComebacks(games,events,openPositions);
    const opportunities=[];
    for(const {milestone,state} of games){
      const candidates=[];
      if(state.verifiedLive && state.scoreKnown)for(const ticker of linkedEventTickers(milestone)){const event=events.get(ticker);if(!event || event.category!=='Sports')continue;
        for(const market of event.markets||[]){const signal=overSignal(state,market)||leadSignal(state,market)||tennisSignal(state,market);if(signal&&!filled.has(`${market.ticker}:${signal.strategy}`))candidates.push({signal,event,market,state,milestone})}}
      if(state.verifiedLive)scanned++;signals+=candidates.length;opportunities.push(...candidates);
      const baseball=/baseball/.test(state.type),tennis=/tennis/.test(state.type),soccer=/soccer/.test(state.type);
      const timeLeft=baseball?`Inning ${state.period||'?'}${Number.isFinite(state.outs)?` · ${state.outs} out(s)`:''}`:tennis?`Set · ${state.tennis?.firstGames ?? '?'}–${state.tennis?.secondGames ?? '?'} games`:soccer?Number.isFinite(state.soccerMinute)?`${state.soccerMinute}' elapsed`:'Clock pending':state.clock?state.clock+' remaining':'Clock pending';
      const clockSeconds=state.verifiedLive?(soccer&&Number.isFinite(state.soccerMinute)&&state.soccerMinute<90?Math.max(0,Math.ceil((90-state.soccerMinute)*60)):!baseball&&!tennis&&!soccer&&Number.isFinite(state.remainingSeconds)?state.remainingSeconds:null):null;
      const clockLabel=soccer?state.soccerMinute>=90?'Stoppage time':'Regulation left':baseball?'Inning progress':tennis?'Set progress':state.sport==='NCAAB'? `Half ${state.period||'?'} left`:/hockey/.test(state.type)?`Period ${state.period||'?'} left`:/football|basketball/.test(state.type)?`Quarter ${state.period||'?'} left`:'Game clock';
      await pool.query(`INSERT INTO game_snapshots(id,title,sport,sport_family,home,away,status,progress,period,time_left,clock_seconds,clock_label,clock_observed_at,scanned_at,signals) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,sport=EXCLUDED.sport,sport_family=EXCLUDED.sport_family,home=EXCLUDED.home,away=EXCLUDED.away,status=EXCLUDED.status,progress=EXCLUDED.progress,period=EXCLUDED.period,time_left=EXCLUDED.time_left,clock_seconds=EXCLUDED.clock_seconds,clock_label=EXCLUDED.clock_label,clock_observed_at=CASE WHEN game_snapshots.clock_seconds IS NOT DISTINCT FROM EXCLUDED.clock_seconds AND game_snapshots.period=EXCLUDED.period AND game_snapshots.status=EXCLUDED.status THEN game_snapshots.clock_observed_at ELSE EXCLUDED.clock_observed_at END,scanned_at=EXCLUDED.scanned_at,signals=EXCLUDED.signals`,[state.id,state.title||'Sports game',state.sport,state.type,state.scoreKnown?state.home:null,state.scoreKnown?state.away:null,state.verifiedLive?'live':/^(final|finished|complete|completed|closed|ended)$/.test(state.status)?'final':'inactive',Number.isFinite(state.progress)?state.progress:null,String(state.period||''),timeLeft,clockSeconds,clockLabel,liveMap.get(milestone.id)?._observed_at||null,scanStarted,JSON.stringify(candidates.map(c=>({strategy:c.signal.strategy,reason:c.signal.reason,ticker:c.market.ticker,execution:signalExecution(c,filled,account,balance,bankroll,overRemaining)}))) ]);
    }
    opportunities.sort((a,b)=>{
      if(a.signal.strategy!==b.signal.strategy)return a.signal.strategy==='over'?-1:1;
      const profit=c=>netSettlementProfitCents(executableCount(c,balance,bankroll,overRemaining),Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
      return profit(b)-profit(a);
    });
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
        const latest=await accountBalance();balance=Number(latest.balance);bankroll=balance+Number(latest.portfolio_value);
        // Revalidate the game before fetching the final quote. Keep the quote
        // as the last remote read before the reserved fill-or-kill submission.
        const latestLive=(await liveBatch([c.milestone])).get(c.milestone.id);
        const freshState=gameState(c.milestone,latestLive);
        if(c.signal.strategy==='lead' && /basketball/.test(state.type) &&
          (freshState.period!==state.period || !freshState.periodConsistent ||
            freshState.remainingSeconds>state.remainingSeconds))continue;
        const quote=(await kalshi('/markets/'+encodeURIComponent(c.market.ticker))).market;
        if(!quote||quote.ticker!==c.market.ticker||!hasAsk(quote))continue;
        const stillQualifies=c.signal.strategy==='over'?overSignal(freshState,quote):leadSignal(freshState,quote)||tennisSignal(freshState,quote);
        if(!stillQualifies)continue;
        c.signal=stillQualifies;
        c.market=quote;
        c.state=state=freshState;
        const budget=c.signal.strategy==='over'?overRemaining:Infinity;
        const wanted=executableCount(c,balance,bankroll,overRemaining);
        if(!wanted)continue;
        const shard=marketShard(c.event,c.market),localCash=shardCash(latest,shard);
        if(localCash===null){executionErrors.push(`${c.market.ticker}: Kalshi shard balance unavailable`);continue}
        if(['check_order','reserved','retrying'].includes(prior.rows[0]?.status)){
          await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,balance);
          continue;
        }
        if(prior.rows[0]?.status==='needs_review')continue;
        const desiredCost=estimatedCostCents(wanted,Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market));
        if(localCash<desiredCost&&transferPlan(latest,shard,desiredCost)){
          await ensureShardFunding(c.signal,c.event,c.market,latest,desiredCost);
          continue;
        }
        if(await submit(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,balance)||await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget,balance)){
          submitted++;filled.add(signalKey(c));const before=balance;const account=await accountBalance({fresh:true});balance=Number(account.balance);bankroll=balance+Number(account.portfolio_value);
          if(c.signal.strategy==='over')overRemaining=Math.max(0,overRemaining-Math.max(0,before-balance));
        }
      }catch(e){const message=`${c.market.ticker}: ${String(e.message).slice(0,170)}`;executionErrors.push(message);console.error('Candidate execution failed:',message)}
    }
    await pool.query('UPDATE scan_status SET last_scan=$5,last_error=$4,scanned=$1,signals=$2,orders_submitted=orders_submitted+$3 WHERE id=1',[scanned,signals,submitted,executionErrors.length?executionErrors.slice(0,2).join('; ').slice(0,250):null,scanStarted]);
    try{await syncSettlementAlerts()}catch(e){console.error('Settlement alert scan failed:',e)}
    return {scanned,signals,submitted,active:active.length,next:games.filter(g=>g.state.verifiedLive || (new Date(g.milestone.start_date).getTime()>Date.now()-3600000 && new Date(g.milestone.start_date).getTime()<Date.now()+3600000)).map(g=>g.milestone)};
  }catch(e){console.error('Scan failed:',e);await pool.query('UPDATE scan_status SET last_scan=now(),last_error=$1,scanned=$2,signals=$3 WHERE id=1',[String(e.message).slice(0,250),scanned,signals]);return {error:e.message,scanned,signals,next:ms}}
  finally{await client.query('ROLLBACK');client.release()}
}
async function state(){const [snap,stats,attempts]=await Promise.all([
  pool.query(`SELECT id,title,sport,home,away,status,time_left,signals FROM game_snapshots WHERE status IN ('live','inprogress','started') AND scanned_at>=(SELECT COALESCE(last_scan,now()-interval '1 minute') FROM scan_status WHERE id=1) ORDER BY jsonb_array_length(signals) DESC,title`),
  pool.query('SELECT * FROM scan_status WHERE id=1'),
  pool.query(`SELECT a.market_ticker,a.game_id,a.sport,a.strategy,a.reason,a.fill_count,a.limit_price,g.status AS game_status,g.title AS game_title,g.sport_family,g.home AS home_score,g.away AS away_score,g.scanned_at AS score_scanned_at,g.clock_seconds,g.clock_label,g.clock_observed_at,g.time_left FROM trade_attempts a LEFT JOIN game_snapshots g ON g.id=a.game_id WHERE a.status='filled' ORDER BY a.created_at DESC`)
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
    const count=Math.min(Number(o.fill_count),Number((positions.market_positions||[]).find(p=>p.ticker===o.market_ticker)?.position_fp||0));
    return {...o,allocated_cents:Math.ceil(count*Number(o.limit_price)*100),potential_profit_cents:netSettlementProfitCents(count,Number(o.limit_price),2)};
  }):[];
  return {live:live(),exitOnly:exitOnly(),credentials:configured(),aiConfigured:Boolean(process.env.AI_API_KEY),balance,accountError,positionsError,games:snap.rows,scan:stats.rows[0],orders};
}
export default {async fetch(req){const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname==='/health')return json({ok:true,live:live(),exitOnly:exitOnly(),credentials:configured(),tradingSwitch:process.env.LIVE_TRADING==='true'?'on':'off',revision:'hockey-three-goals-six-thirty-time-tiers'});
  if(req.method==='GET'&&url.pathname==='/manifest.webmanifest')return response(manifest,'application/manifest+json');
  if(req.method==='GET'&&url.pathname==='/sw.js')return new Response(worker,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','service-worker-allowed':'/','x-content-type-options':'nosniff'}});
  if(req.method==='GET'&&/^\/icon-(192|512)\.png$/.test(url.pathname))return response(Buffer.from(icons[Number(url.pathname.match(/\d+/)[0])],'base64'),'image/png');
  if(req.method==='POST'&&url.pathname==='/tick'){
    if(!req.headers.get('x-neon-trigger-invocation-id'))return json({error:'Forbidden'},403);
    // Neon cron has minute resolution. Short invocations keep the three-second loop alive
    // without relying on one function instance surviving for a full quarter hour.
    const now=Date.now();const until=Math.min(now+55000,(Math.floor(now/60000)+1)*60000-2000);let cached=null,cycles=0,last={};
    while(Date.now()<until){const begun=Date.now();last=await scan(cached);cycles++;
      if(last.next)cached=last.next;if(last.error && !/Kalshi 429 /.test(last.error) || !last.error && !last.active)break;
      const pause=Math.max(0,3000-(Date.now()-begun));if(Date.now()+pause>=until)break;
      await new Promise(resolve=>setTimeout(resolve,pause));
    }
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
  if(!dashboardAuth(req))return url.pathname==='/'?new Response(null,{status:303,headers:{location:'/login','cache-control':'no-store'}}):json({error:'Sign in required'},401);
  try{
    if(req.method==='GET'&&url.pathname==='/api/push-key')return json({key:pushIdentity().publicBase64});
    if(req.method==='GET'&&url.pathname==='/api/alerts'){
      const since=Number(url.searchParams.get('since'))||0;
      if(!Number.isFinite(since)||since<0)return json({error:'Invalid cursor'},400);
      const alerts=await pool.query(`SELECT id,ticker,profit_cents,settled_time,created_at FROM settlement_alerts WHERE id>$1 AND created_at>now()-interval '2 days' ORDER BY id LIMIT 50`,[since]);
      return json({alerts:alerts.rows});
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
    if(req.method==='GET'&&url.pathname==='/api/state')return json(await state());
    if(req.method==='GET'&&url.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}})
  }catch(e){console.error(e);return json({error:'Service unavailable'},503)}
  return json({error:'Not found'},404);
}};
