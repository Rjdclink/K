import { timingSafeEqual, randomUUID } from 'node:crypto';
import pg from 'pg';
import { page } from './ui.mjs';
import { gameState, overSignal, leadSignal, tennisSignal, orderSize, estimatedCostCents, overBudget } from './strategy.mjs';
import { reviewMiss } from './ai.mjs';
import { kalshiSignature } from './auth.mjs';
import { marketShard, shardCash, transferPlan } from './funding.mjs';

const API='https://external-api.kalshi.com/trade-api/v2';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:4, idleTimeoutMillis:15000});
pool.on('error', e=>console.error('Idle database connection:',e.message));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const configured=()=>Boolean((process.env.KALSHI_API_KEY||process.env.KALSHI_API_KEY_ID) && process.env.KALSHI_PRIVATE_KEY);
const live=()=>configured() && process.env.LIVE_TRADING==='true';
const credentials=()=>({key:process.env.KALSHI_API_KEY||process.env.KALSHI_API_KEY_ID,privateKey:process.env.KALSHI_PRIVATE_KEY});
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y)};
function authorized(req){const expected=process.env.DASHBOARD_PASSWORD;if(!expected)return false;const raw=req.headers.get('authorization')||'';if(!raw.startsWith('Basic '))return false;try{const [user,...password]=Buffer.from(raw.slice(6),'base64').toString('utf8').split(':');return user==='rjdc'&&safeEqual(password.join(':'),expected)}catch{return false}}
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
// Kalshi's balance endpoint has a separate one-request-per-second Basic tier bucket.
let balanceQueue=Promise.resolve(), lastBalanceCall=0;
function accountBalance(){
  const job=balanceQueue.catch(()=>{}).then(async()=>{
    const delay=1100-(Date.now()-lastBalanceCall);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    lastBalanceCall=Date.now();return kalshi('/portfolio/balance',{auth:true});
  });
  balanceQueue=job.catch(()=>{});return job;
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
    list.forEach(d=>map.set(d.milestone_id,d));}
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
function feeReserve(event,market){return Math.max(2,Number(process.env.FEE_MULTIPLIER_RESERVE)||2,Number(event?.fee_multiplier_override)||0,Number(market?.fee_multiplier_override)||0)}
const minimumCount=market=>market.fractional_trading_enabled===false?1:0.01;
const hasAsk=market=>Number.isFinite(Number(market.yes_ask_size_fp))&&Number(market.yes_ask_size_fp)>=minimumCount(market);
function contractCount(balance,market,fraction,bankroll,budget,fees){
  const count=orderSize(balance,market.yes_ask_dollars,market.yes_ask_size_fp,fraction,Number(process.env.MAX_YES_PRICE||1),bankroll,budget,fees);
  return market.fractional_trading_enabled===false?Math.floor(count):count;
}
const signalKey=c=>`${c.market.ticker}:${c.signal.strategy}`;
function signalExecution(c,filled,account,balance,bankroll,overRemaining){
  if(filled.has(signalKey(c)))return 'Already filled';
  if(!hasAsk(c.market))return 'No ask liquidity';
  const price=Number(c.market.yes_ask_dollars),fees=feeReserve(c.event,c.market);
  const count=contractCount(balance,c.market,c.signal.fraction,bankroll,c.signal.strategy==='over'?overRemaining:Infinity,fees);
  if(!count)return 'Insufficient budget or price above cap';
  const local=shardCash(account,marketShard(c.event,c.market));
  if(local===null)return 'Shard balance unavailable';
  return local<estimatedCostCents(minimumCount(c.market),price,fees)?'Awaiting shard funding':'Eligible for submission';
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
async function submit(signal,game,event,market,balance,bankroll,budgetCents=Infinity){
  const price=Number(market.yes_ask_dollars);const count=contractCount(balance,market,signal.fraction,bankroll,budgetCents,feeReserve(event,market));if(!count)return false;
  const id=await reserve(signal,game,event,market,count,price,balance);if(!id)return false;
  try{
    // IOC fills available contracts immediately without leaving an unfilled order resting.
    const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:market.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[id,Number(result.fill_count)>0?'filled':'unfilled',result.order_id||null,Number(result.fill_count||0)]);
    return Number(result.fill_count)>0;
  }catch(e){const terminal=/^Kalshi (400|401|403|404|422) /.test(String(e.message));await pool.query(`UPDATE trade_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,terminal?'rejected':'check_order',String(e.message).slice(0,250)]);console.error('Order needs reconciliation:',market.ticker,e.message);return false}
}
async function recoverPending(signal,game,event,market,balance,bankroll,budgetCents=Infinity){
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
  if(Number(row.count)>contractCount(balance,{...market,yes_ask_dollars:row.limit_price},signal.fraction,bankroll,budgetCents,feeReserve(event,market)))return false;
  const claim=await pool.query(`UPDATE trade_attempts SET retries=1,status='retrying',ai_review=$2,updated_at=now() WHERE id=$1 AND status IN ('check_order','reserved') AND retries=0 RETURNING id`,[row.id,review.reason]);
  if(!claim.rowCount)return false;
  try{const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:row.market_ticker,client_order_id:row.id,side:'bid',count:Number(row.count).toFixed(2),price:Number(row.limit_price).toFixed(4),time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    const filled=Number(result.fill_count||0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',result.order_id||null,filled]);return filled>0
  }catch(e){await pool.query(`UPDATE trade_attempts SET status='check_order',error=$2,updated_at=now() WHERE id=$1`,[row.id,'Recovery response uncertain: '+String(e.message).slice(0,200)]);return false}
}
async function scan(cachedMilestones){
  // A transaction-scoped lock is released by Postgres even if an invocation is terminated.
  // Snapshot writes use other pool connections so the dashboard sees each completed cycle.
  const client=await pool.connect();await client.query('BEGIN');
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(83027543) AS acquired');
  if(!lock.rows[0].acquired){await client.query('ROLLBACK');client.release();return {skipped:'scan in progress'}};
  let scanned=0,signals=0,submitted=0,ms;const executionErrors=[];
  try{
    ms=cachedMilestones||await milestones();const liveMap=await liveBatch(ms);
    const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))}));
    const active=games.filter(g=>g.state.verifiedLive && g.state.scoreKnown);
    const events=await marketMap(active.flatMap(g=>linkedEventTickers(g.milestone)));
    let balance=0,bankroll=0,overRemaining=0,account=null;let filled=new Set();
    if(live()){
      const [currentAccount,positions,attempts,existingFills]=await Promise.all([
        accountBalance(),
        kalshi('/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=1000',{auth:true}),
        pool.query(`SELECT market_ticker,fill_count,limit_price FROM trade_attempts WHERE strategy='over' AND status='filled'`),
        pool.query(`SELECT market_ticker,strategy FROM trade_attempts WHERE status='filled'`)
      ]);
      filled=new Set(existingFills.rows.map(r=>`${r.market_ticker}:${r.strategy}`));
      if(positions.cursor)throw Error('Over exposure cannot be bounded: positions exceed one page');
      account=currentAccount;balance=Number(account.balance);
      bankroll=balance+Number(account.portfolio_value);
      const open=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
      const exposure=attempts.rows.reduce((sum,r)=>sum+(open.has(r.market_ticker)?Number(r.fill_count)*Number(r.limit_price)*100:0),0);
      overRemaining=overBudget(balance,account.portfolio_value,exposure);
    }
    for(const {milestone,state} of games){
      const candidates=[];
      if(state.verifiedLive && state.scoreKnown)for(const ticker of linkedEventTickers(milestone)){const event=events.get(ticker);if(!event || event.category!=='Sports')continue;
        for(const market of event.markets||[]){const signal=overSignal(state,market)||leadSignal(state,market)||tennisSignal(state,market);if(signal)candidates.push({signal,event,market})}}
      if(state.verifiedLive)scanned++;signals+=candidates.length;
      await pool.query(`INSERT INTO game_snapshots(id,title,sport,home,away,status,progress,period,scanned_at,signals) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,sport=EXCLUDED.sport,home=EXCLUDED.home,away=EXCLUDED.away,status=EXCLUDED.status,progress=EXCLUDED.progress,period=EXCLUDED.period,scanned_at=now(),signals=EXCLUDED.signals`,[state.id,state.title||'Sports game',state.sport,state.scoreKnown?state.home:null,state.scoreKnown?state.away:null,state.verifiedLive?'live':'inactive',Number.isFinite(state.progress)?state.progress:null,String(state.period||''),JSON.stringify(candidates.map(c=>({strategy:c.signal.strategy,reason:c.signal.reason,ticker:c.market.ticker,execution:signalExecution(c,filled,account,balance,bankroll,overRemaining)}))) ]);
      if(live())for(const c of candidates)try{
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
        const budget=c.signal.strategy==='over'?overRemaining:Infinity;
        const wanted=contractCount(balance,c.market,c.signal.fraction,bankroll,budget,feeReserve(c.event,c.market));
        if(!wanted)continue;
        const shard=marketShard(c.event,c.market),localCash=shardCash(latest,shard);
        if(localCash===null){executionErrors.push(`${c.market.ticker}: Kalshi shard balance unavailable`);continue}
        if(['check_order','reserved','retrying'].includes(prior.rows[0]?.status)){
          await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget);
          continue;
        }
        if(prior.rows[0]?.status==='needs_review')continue;
        if(localCash<estimatedCostCents(minimumCount(c.market),Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market))){
          await ensureShardFunding(c.signal,c.event,c.market,latest,estimatedCostCents(wanted,Number(c.market.yes_ask_dollars),feeReserve(c.event,c.market)));
          continue;
        }
        if(await submit(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget)||await recoverPending(c.signal,state,c.event,c.market,Math.min(balance,localCash),bankroll,budget)){
          submitted++;filled.add(signalKey(c));const before=balance;const account=await accountBalance();balance=Number(account.balance);bankroll=balance+Number(account.portfolio_value);
          if(c.signal.strategy==='over')overRemaining=Math.max(0,overRemaining-Math.max(0,before-balance));
        }
      }catch(e){const message=`${c.market.ticker}: ${String(e.message).slice(0,170)}`;executionErrors.push(message);console.error('Candidate execution failed:',message)}
    }
    await pool.query('UPDATE scan_status SET last_scan=now(),last_error=$4,scanned=$1,signals=$2,orders_submitted=orders_submitted+$3 WHERE id=1',[scanned,signals,submitted,executionErrors.length?executionErrors.slice(0,2).join('; ').slice(0,250):null]);
    return {scanned,signals,submitted,active:active.length,next:games.filter(g=>g.state.verifiedLive || (new Date(g.milestone.start_date).getTime()>Date.now()-3600000 && new Date(g.milestone.start_date).getTime()<Date.now()+3600000)).map(g=>g.milestone)};
  }catch(e){console.error('Scan failed:',e);await pool.query('UPDATE scan_status SET last_scan=now(),last_error=$1,scanned=$2,signals=$3 WHERE id=1',[String(e.message).slice(0,250),scanned,signals]);return {error:e.message,scanned,signals,next:ms}}
  finally{await client.query('ROLLBACK');client.release()}
}
async function state(){const [snap,stats,attempts]=await Promise.all([
  pool.query(`SELECT id,title,sport,home,away,status,signals FROM game_snapshots WHERE status IN ('live','inprogress','started') AND scanned_at>(SELECT COALESCE(last_scan,now()-interval '1 minute')-interval '5 seconds' FROM scan_status WHERE id=1) ORDER BY jsonb_array_length(signals) DESC,title LIMIT 100`),
  pool.query('SELECT * FROM scan_status WHERE id=1'),
  pool.query(`SELECT market_ticker,sport,strategy,reason,fill_count FROM trade_attempts WHERE status='filled' ORDER BY created_at DESC LIMIT 100`)
]);
  let balance=null,positions=null,accountError=null,positionsError=null;
  if(configured()){
    const [balanceResult,positionsResult]=await Promise.allSettled([
      accountBalance(),kalshi('/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=500',{auth:true})
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
  const orders=positions?attempts.rows.filter(o=>open.has(o.market_ticker)):[];
  return {live:live(),credentials:configured(),aiConfigured:Boolean(process.env.AI_API_KEY),balance,accountError,positionsError,games:snap.rows,scan:stats.rows[0],orders};
}
export default {async fetch(req){const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname==='/health')return json({ok:true,live:live(),credentials:configured(),tradingSwitch:process.env.LIVE_TRADING==='true'?'on':'off',revision:'liquidity-fractional-2'});
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
  if(!authorized(req))return new Response('Authentication required',{status:401,headers:{'www-authenticate':'Basic realm="K Trading"','cache-control':'no-store'}});
  try{if(req.method==='GET'&&url.pathname==='/api/state')return json(await state());if(req.method==='GET'&&url.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}})}catch(e){console.error(e);return json({error:'Service unavailable'},503)}
  return json({error:'Not found'},404);
}};
