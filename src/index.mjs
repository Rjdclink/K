import { createPrivateKey, sign, constants, timingSafeEqual, randomUUID } from 'node:crypto';
import pg from 'pg';
import { page } from './ui.mjs';
import { gameState, overSignal, leadSignal, orderSize, overBudget, touchdownsFromPbp } from './strategy.mjs';
import { reviewMiss } from './ai.mjs';

const API='https://external-api.kalshi.com/trade-api/v2';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:4, idleTimeoutMillis:15000});
pool.on('error', e=>console.error('Idle database connection:',e.message));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const configured=()=>Boolean(process.env.KALSHI_API_KEY && process.env.KALSHI_PRIVATE_KEY);
const live=()=>configured() && process.env.LIVE_TRADING==='true';
const credentials=()=>({key:process.env.KALSHI_API_KEY,privateKey:process.env.KALSHI_PRIVATE_KEY?.replace(/\\n/g,'\n')});
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y)};
function authorized(req){const expected=process.env.DASHBOARD_PASSWORD;if(!expected)return false;const raw=req.headers.get('authorization')||'';if(!raw.startsWith('Basic '))return false;try{const [user,...password]=Buffer.from(raw.slice(6),'base64').toString('utf8').split(':');return user==='admin'&&safeEqual(password.join(':'),expected)}catch{return false}}
async function kalshi(path,opts={}){
  const method=opts.method||'GET';const headers={'accept':'application/json'};
  if(opts.auth){const {key,privateKey}=credentials();if(!key||!privateKey)throw Error('Kalshi credentials unavailable');const timestamp=String(Date.now());const unsignedPath='/trade-api/v2'+path.split('?')[0];const signature=sign('sha256',Buffer.from(timestamp+method+unsignedPath),{key:createPrivateKey(privateKey),padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST}).toString('base64');Object.assign(headers,{'KALSHI-ACCESS-KEY':key,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature})}
  if(opts.body)headers['content-type']='application/json';
  const response=await fetch(API+path,{method,headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(`Kalshi ${response.status}: ${String(data.message||data.error||data.code||'request failed').slice(0,180)}`);
  return data;
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
  const found=[];let cursor='';const min=new Date(Date.now()-36*3600000).toISOString();
  for(let i=0;i<5;i++){
    const q=new URLSearchParams({category:'Sports',limit:'500',minimum_start_date:min});if(cursor)q.set('cursor',cursor);
    const x=await kalshi('/milestones?'+q);found.push(...(x.milestones||[]));cursor=x.cursor;if(!cursor)break;
  }
  const now=Date.now();return found.filter(m=>m.id && new Date(m.start_date).getTime()<now+3600000 && (!m.end_date||new Date(m.end_date).getTime()>now-3600000));
}
async function liveBatch(ms){
  const map=new Map();for(let i=0;i<ms.length;i+=80){const group=ms.slice(i,i+80);const q=new URLSearchParams();group.forEach(m=>q.append('milestone_ids',m.id));
    let list=[];try{list=(await kalshi('/live_data/batch?'+q)).live_datas||[]}catch(e){console.warn('Live batch fallback:',e.message);const results=await Promise.allSettled(group.map(m=>kalshi('/live_data/milestone/'+encodeURIComponent(m.id))));list=results.filter(r=>r.status==='fulfilled').map(r=>r.value.live_data).filter(Boolean)}
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
async function reserve(signal,game,event,market,count,price){const id=randomUUID();const {rowCount}=await pool.query(`INSERT INTO trade_attempts(id,market_ticker,event_ticker,game_id,sport,strategy,reason,fraction,count,limit_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(market_ticker,strategy) DO NOTHING`,[id,market.ticker,event.event_ticker,game.id,game.sport,signal.strategy,signal.reason,signal.fraction,count,price]);return rowCount?id:null}
async function submit(signal,game,event,market,balance,budgetCents=Infinity){
  const price=Number(market.yes_ask_dollars);const count=Math.min(orderSize(balance,price,market.yes_ask_size_fp,signal.fraction,Number(process.env.MAX_YES_PRICE||0.98)),Math.floor(budgetCents/(price*100)));if(!count)return false;
  const id=await reserve(signal,game,event,market,count,price);if(!id)return false;
  try{
    // FOK leaves no unfilled orders resting. The UUID is reused for reconciliation after an uncertain response.
    const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:market.ticker,client_order_id:id,side:'bid',count:count.toFixed(2),price:price.toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[id,Number(result.fill_count)>0?'filled':'unfilled',result.order_id||null,Number(result.fill_count||0)]);
    return Number(result.fill_count)>0;
  }catch(e){const terminal=/^Kalshi (400|401|403|422):/.test(String(e.message));await pool.query(`UPDATE trade_attempts SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[id,terminal?'rejected':'check_order',String(e.message).slice(0,250)]);console.error('Order needs reconciliation:',market.ticker,e.message);return false}
}
async function recoverPending(signal,game,market,balance,budgetCents=Infinity){
  const {rows:[row]}=await pool.query(`SELECT * FROM trade_attempts WHERE market_ticker=$1 AND strategy=$2 AND status IN ('check_order','reserved')`,[market.ticker,signal.strategy]);
  if(!row)return false;
  // Never send a second order until the exchange has been queried for the original client ID.
  try{const orders=await kalshi('/portfolio/orders?'+new URLSearchParams({ticker:market.ticker,limit:'1000'}),{auth:true});
    const matched=(orders.orders||[]).find(o=>o.client_order_id===row.id);
    if(matched){const filled=Number(matched.fill_count_fp??matched.fill_count??0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',matched.order_id||null,filled]);return filled>0}
  }catch(e){console.warn('Order history unavailable; retry deferred:',e.message);return false}
  if(row.retries || Date.now()-new Date(row.updated_at).getTime()<15000)return false;
  // The supervisor reviews a missing submission. An unavailable model falls back to one bounded deterministic retry.
  let review;try{review=await reviewMiss({signal,game,market,error:row.error})}catch(e){review={available:false,retry:true,reason:'AI unavailable: '+e.message}}
  if(!review.retry){await pool.query(`UPDATE trade_attempts SET status='needs_review',ai_review=$2,updated_at=now() WHERE id=$1`,[row.id,review.reason]);return false}
  if(Number(row.count)>Math.min(orderSize(balance,row.limit_price,market.yes_ask_size_fp,signal.fraction,Number(process.env.MAX_YES_PRICE||0.98)),Math.floor(budgetCents/(Number(row.limit_price)*100))))return false;
  const claim=await pool.query(`UPDATE trade_attempts SET retries=1,status='retrying',ai_review=$2,updated_at=now() WHERE id=$1 AND status IN ('check_order','reserved') AND retries=0 RETURNING id`,[row.id,review.reason]);
  if(!claim.rowCount)return false;
  try{const result=await kalshi('/portfolio/events/orders',{method:'POST',auth:true,body:{ticker:row.market_ticker,client_order_id:row.id,side:'bid',count:Number(row.count).toFixed(2),price:Number(row.limit_price).toFixed(4),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',post_only:false}});
    const filled=Number(result.fill_count||0);await pool.query(`UPDATE trade_attempts SET status=$2,order_id=$3,fill_count=$4,updated_at=now() WHERE id=$1`,[row.id,filled>0?'filled':'unfilled',result.order_id||null,filled]);return filled>0
  }catch(e){await pool.query(`UPDATE trade_attempts SET status='check_order',error=$2,updated_at=now() WHERE id=$1`,[row.id,'Recovery response uncertain: '+String(e.message).slice(0,200)]);return false}
}
async function scan(cachedMilestones){
  // Postgres advisory lock prevents overlapping scheduled invocations from spending the same balance.
  const client=await pool.connect();const lock=await client.query('SELECT pg_try_advisory_lock(83027542) AS acquired');if(!lock.rows[0].acquired){client.release();return {skipped:'scan in progress'}};
  let scanned=0,signals=0,submitted=0;
  try{
    const ms=cachedMilestones||await milestones();const liveMap=await liveBatch(ms);
    const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))}));
    for(const game of games){const s=game.state;
      if(s.verifiedLive && /football_game/.test(s.type) && s.period===4 && Number.isFinite(s.remainingSeconds) && s.remainingSeconds>0 && s.remainingSeconds<420){
        try{const stats=await kalshi('/live_data/milestone/'+encodeURIComponent(s.id)+'/game_stats');const td=touchdownsFromPbp(stats.pbp,s.home,s.away);if(td){s.homeUnits=td.home;s.awayUnits=td.away}}catch(e){console.warn('Touchdown feed unavailable:',s.id,e.message)}
      }
    }
    const active=games.filter(g=>g.state.verifiedLive && g.state.scoreKnown);
    const events=await marketMap(active.flatMap(g=>linkedEventTickers(g.milestone)));
    let balance=0,overRemaining=0;
    if(live()){
      const [account,positions,attempts]=await Promise.all([
        accountBalance(),
        kalshi('/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=1000',{auth:true}),
        pool.query(`SELECT market_ticker,fill_count,limit_price FROM trade_attempts WHERE strategy='over' AND status='filled'`)
      ]);
      if(positions.cursor)throw Error('Over exposure cannot be bounded: positions exceed one page');
      balance=Number(account.balance);
      const open=new Set((positions.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
      const exposure=attempts.rows.reduce((sum,r)=>sum+(open.has(r.market_ticker)?Number(r.fill_count)*Number(r.limit_price)*100:0),0);
      overRemaining=overBudget(balance,account.portfolio_value,exposure);
    }
    for(const {milestone,state} of games){
      const candidates=[];
      if(state.verifiedLive && state.scoreKnown)for(const ticker of linkedEventTickers(milestone)){const event=events.get(ticker);if(!event || event.category!=='Sports')continue;
        for(const market of event.markets||[]){const signal=overSignal(state,market)||leadSignal(state,market);if(signal)candidates.push({signal,event,market})}}
      if(state.verifiedLive)scanned++;signals+=candidates.length;
      await client.query(`INSERT INTO game_snapshots(id,title,sport,home,away,status,progress,period,scanned_at,signals) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,sport=EXCLUDED.sport,home=EXCLUDED.home,away=EXCLUDED.away,status=EXCLUDED.status,progress=EXCLUDED.progress,period=EXCLUDED.period,scanned_at=now(),signals=EXCLUDED.signals`,[state.id,state.title||'Sports game',state.sport,state.scoreKnown?state.home:null,state.scoreKnown?state.away:null,state.verifiedLive?'live':'inactive',Number.isFinite(state.progress)?state.progress:null,String(state.period||''),JSON.stringify(candidates.map(c=>({strategy:c.signal.strategy,reason:c.signal.reason,ticker:c.market.ticker}))) ]);
      if(live())for(const c of candidates){const budget=c.signal.strategy==='over'?overRemaining:Infinity;
        if(await submit(c.signal,state,c.event,c.market,balance,budget)||await recoverPending(c.signal,state,c.market,balance,budget)){
          submitted++;const before=balance;balance=Number((await accountBalance()).balance);
          if(c.signal.strategy==='over')overRemaining=Math.max(0,overRemaining-Math.max(0,before-balance));
        }
      }
    }
    await client.query('UPDATE scan_status SET last_scan=now(),last_error=NULL,scanned=$1,signals=$2,orders_submitted=orders_submitted+$3 WHERE id=1',[scanned,signals,submitted]);
    return {scanned,signals,submitted,active:active.filter(g=>/football_game|basketball_game|baseball_game|hockey_match|soccer/.test(g.state.type)).length,next:games.filter(g=>g.state.verifiedLive || (new Date(g.milestone.start_date).getTime()>Date.now()-3600000 && new Date(g.milestone.start_date).getTime()<Date.now()+3600000)).map(g=>g.milestone)};
  }catch(e){console.error('Scan failed:',e);await client.query('UPDATE scan_status SET last_scan=now(),last_error=$1,scanned=$2,signals=$3 WHERE id=1',[String(e.message).slice(0,250),scanned,signals]);return {error:e.message,scanned,signals}}
  finally{await client.query('SELECT pg_advisory_unlock(83027542)');client.release()}
}
async function state(){const [snap,stats,attempts]=await Promise.all([
  pool.query(`SELECT id,title,sport,home,away,status,signals FROM game_snapshots WHERE status IN ('live','inprogress','started') AND scanned_at>(SELECT COALESCE(last_scan,now()-interval '1 minute')-interval '5 seconds' FROM scan_status WHERE id=1) ORDER BY jsonb_array_length(signals) DESC,title LIMIT 100`),
  pool.query('SELECT * FROM scan_status WHERE id=1'),
  pool.query(`SELECT market_ticker,sport,strategy,reason,fill_count FROM trade_attempts WHERE status='filled' ORDER BY created_at DESC LIMIT 100`)
]);
  let balance=null,positions=null,accountError=null;
  if(configured())try{[balance,positions]=await Promise.all([accountBalance(),kalshi('/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=500',{auth:true})])}catch(e){accountError=e.message}
  const open=new Set((positions?.market_positions||[]).filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
  const orders=positions?attempts.rows.filter(o=>open.has(o.market_ticker)):[];
  return {live:live(),aiConfigured:Boolean(process.env.AI_API_KEY),balance,accountError,games:snap.rows,scan:stats.rows[0],orders};
}
export default {async fetch(req){const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname==='/health')return json({ok:true,live:live(),credentials:configured()});
  if(req.method==='POST'&&url.pathname==='/tick'){
    if(!req.headers.get('x-neon-trigger-invocation-id'))return json({error:'Forbidden'},403);
    const now=Date.now();const until=Math.min(now+14*60000+30000,(Math.floor(now/900000)+1)*900000-10000);let cached=null,cycles=0,last={};
    while(Date.now()<until){const begun=Date.now();last=await scan(cached);cycles++;
      if(last.next)cached=last.next;if(last.error || !last.active)break;
      const pause=Math.max(0,3000-(Date.now()-begun));if(Date.now()+pause>=until)break;
      await new Promise(resolve=>setTimeout(resolve,pause));
    }
    const {next,...summary}=last;return json({...summary,cycles});
  }
  if(!authorized(req))return new Response('Authentication required',{status:401,headers:{'www-authenticate':'Basic realm="K Trading"','cache-control':'no-store'}});
  try{if(req.method==='GET'&&url.pathname==='/api/state')return json(await state());if(req.method==='GET'&&url.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}})}catch(e){console.error(e);return json({error:'Service unavailable'},503)}
  return json({error:'Not found'},404);
}};
