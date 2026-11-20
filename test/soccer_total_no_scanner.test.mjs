import {noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey} from './support/no_ask_mock.mjs';
import {pairedExternalMatch} from '../src/independent_match_score.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tagNoPreflight,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
import {readFileSync} from 'node:fs';
import {gameState,orderSize,estimatedCostCents} from '../src/strategy.mjs';
import {soccerNoMarketSpec,soccerTotalNo} from '../src/soccer_total_no.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

const milestone={id:'soccer-scanner',title:'Away at Home',type:'soccer_match',
  start_date:'2026-11-20T17:00:00Z',
  details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV20AWAYHOME'}};
const state=(seconds=540,home=2,away=1)=>gameState(milestone,{
  milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:home,away_score:away,half:'2nd',
    time:Math.floor((5400-seconds)/60)+':'+String((5400-seconds)%60).padStart(2,'0')+"'",
    home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}});
const market={ticker:'KXEPLTOTAL-26NOV20AWAYHOME-5',
  event_ticker:'KXEPLTOTAL-26NOV20AWAYHOME',
  title:'Will over 4.5 goals be scored?',yes_sub_title:'Over 4.5 goals scored',
  floor_strike:4.5,strike_type:'greater',status:'active',
  rules_primary:'If over 4.5 goals are scored in the Away vs Home professional EPL soccer game originally scheduled for Nov 20, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};
const events=new Map([[market.event_ticker,{event_ticker:market.event_ticker,category:'Sports',markets:[market]}]]);

function harness({canVerify=true,hasSeller=true,initialAgeMs=61000,existingExposure=false,
  afterRefreshScore=3,missingClock=false,finalExternalFails=false,duplicate=false,globalPending=false,noAskPolicy=noAskTimeout}={}){
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function scanSoccerTotalNos('),b=src.indexOf('async function scan(cachedMilestones',a);
  assert.ok(a>0&&b>a,'soccer NO scanner must be confined to a dedicated function');
  const code=src.slice(a,b);
  const windows=new Map(),dashboard=new Map(),trace=[],diagnostics=[];
  let verified=0,orders=0,lastBudget=null,lastFraction=null,lastQuantity=null;
  const held={ticker:'KXEPLTOTAL-OLDER',position_fp:-1,market_exposure_dollars:'4.00',fees_paid_dollars:'0.50'};
  const context=vm.createContext({noAskTimeout:noAskPolicy,waitingOnAsk,NO_ASK_RETIRED,noAskKey,recordDecision:async decision=>{diagnostics.push(decision)},pairedExternalMatch,tagNoPreflight,validNoPreflight,lateNoPreflightProgress,
    Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    soccerNoMarketSpec,soccerTotalNo,
    verifyIndependentSoccerTotalNo:async game=>{
      verified++;trace.push('external');
      if(!canVerify||finalExternalFails&&verified>1)return null;
      return {source:'ESPN',eventId:'espn-soccer',home:game.home,away:game.away,
        period:2,elapsedMinute:game.soccerMinute,live:true};
    },
    overContractKey,sameSportsContract,
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM soccer_total_no_windows'))
        return {rows:windows.has(args[0])?[windows.get(args[0])]:[]};
      if(sql.startsWith('INSERT INTO soccer_total_no_windows')){
        windows.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],
          period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),
          first_at:new Date(Date.now()-initialAgeMs)});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts')){
        const isGlobal=sql.includes("WHERE strategy='no'");
        const blocked=isGlobal?globalPending:duplicate;
        return {rows:blocked?[{id:'existing'}]:[],rowCount:blocked?1:0};
      }
      if(sql.startsWith('SELECT market_ticker,fill_count'))
        return {rows:existingExposure?[{market_ticker:held.ticker}]:[]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({
      milestone_id:milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_score:afterRefreshScore===3?2:3,away_score:1,half:'2nd',
        time:missingClock?'garbled':"82:01'",
        home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}}),
    gameState,
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook')){
        trace.push('orderbook');
        return {orderbook_fp:{yes_dollars:hasSeller?[['0.50','100']]:[]}};
      }
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){
        orders++;trace.push('order');
        assert.equal(opts.body.side,'ask');
        assert.equal(opts.body.time_in_force,'fill_or_kill');
        opts.beforeDispatch();
        return {fill_count_fp:'1',order_id:'filled'};
      }
      throw Error(path);
    },
    bestNoAsk,noDepthAtAsk,minimumCount:()=>.01,
    allOpenPositions:async()=>({market_positions:existingExposure?[held]:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>2,
    orderSize:(cash,price,depth,fraction,min,bankroll,budget,fees)=>{
      lastFraction=fraction;lastBudget=budget;
      lastQuantity=orderSize(cash,price,depth,fraction,min,bankroll,budget,fees);
      return lastQuantity;
    },
    profitableCount:n=>n>0,estimatedCostCents,
    auditTable:async()=>{},randomUUID:()=> 'soccer-verification',rememberIndependentEntry,
    reserve:async signal=>{
      trace.push('reserve');assert.equal(signal.fraction,.05);return 'soccer-order';
    },
    withEntryProfitFloor:async(options,send)=>{
      assert.equal(options.fraction,.05);return send();
    },
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  return {
    scan:seconds=>context.scanSoccerTotalNos([{milestone,state:state(seconds)}],events,dashboard),
    get windows(){return windows;},get trace(){return trace;},
    get dashboard(){return dashboard;},get diagnostics(){return diagnostics;},get verifications(){return verified;},
    get orders(){return orders;},get lastBudget(){return lastBudget;},
    get lastFraction(){return lastFraction;},get lastQuantity(){return lastQuantity;}
  };
}

test('NO book probes stop at 30 elapsed seconds of absent asks, even when game clock is stopped',async()=>{
 let elapsed=0,firstAt=null;
 const gate={
  isRetired:async()=>firstAt!==null&&elapsed-firstAt>=30_000,
  observeMissing:async()=>{
   if(firstAt===null)firstAt=elapsed;
   const age=elapsed-firstAt;
   return {retired:age>=30_000,elapsedMs:Math.min(30_000,age)};
  },
  available:async()=>{},retired:async()=>new Set(),missing:async()=>new Map()
 };
 const h=harness({hasSeller:false,noAskPolicy:gate});
 assert.equal(await h.scan(540),0,'first ESPN score check remains scheduled');
 assert.equal(h.windows.size,1);
 assert.equal(await h.scan(479),0,'first missing NO ask begins its 30-second grace');
 assert.equal(h.trace.filter(t=>t==='orderbook').length,1);
 elapsed=29_999;
 assert.equal(await h.scan(479),0,'another probe may occur within the 30-second grace');
 assert.equal(h.trace.filter(t=>t==='orderbook').length,2);
 elapsed=30_000;
 assert.equal(await h.scan(479),0,'same contract is retired after 30 seconds');
 assert.equal(h.trace.filter(t=>t==='orderbook').length,2,
   'no more orderbook calls for a retired market');
 assert.equal(h.verifications,1,'retired market also avoids further independent score calls');
 assert.equal((h.dashboard.get(milestone.id)||[]).find(x=>x.ticker===market.ticker)?.execution,
   NO_ASK_RETIRED);
 assert.equal(h.orders,0);
});

test('a qualifying soccer NO cushion is not mislabeled when external score coverage is unavailable',async()=>{
  const blocked=harness({canVerify:false});
  await blocked.scan(540);
  assert.equal(blocked.orders,0);
  assert.equal(blocked.diagnostics.length,1);
  assert.equal(blocked.diagnostics[0].source,'soccer_total_no');
  assert.equal(blocked.diagnostics[0].stage,'independent_score');
  assert.match(blocked.diagnostics[0].detail,/No matching fixture and score verified by ESPN/);
  assert.doesNotMatch(blocked.diagnostics[0].detail,/cushion/i);
  assert.equal((blocked.dashboard.get(milestone.id)||[])[0].execution,blocked.diagnostics[0].detail);
  const verified=harness();
  await verified.scan(540);
  assert.equal(verified.diagnostics.length,1);
  assert.match(verified.diagnostics[0].detail,/score check recorded/);
  assert.equal(verified.orders,0,'the first check never authorizes an immediate order');
});

test('soccer NO checks once near 9:00 and once just before entry strictly under 8:00',async()=>{
  const h=harness();
  assert.equal(await h.scan(541),0);
  assert.equal(h.verifications,0);
  assert.equal(await h.scan(540),0);
  assert.equal(h.windows.size,1);
  assert.equal(h.orders,0);
  assert.equal(await h.scan(480),0);
  assert.equal(h.verifications,1,'waiting at eight minutes must not repeat external proof');
  assert.equal(await h.scan(479),1);
  assert.equal(h.verifications,2);
  assert.equal(h.orders,1);
  assert.equal(h.lastFraction,.05);
  assert.ok(h.lastQuantity>0);
  assert.ok(h.trace.indexOf('orderbook')<h.trace.lastIndexOf('external'));
  assert.ok(h.trace.lastIndexOf('external')<h.trace.lastIndexOf('reserve'));
  assert.ok((h.dashboard.get(milestone.id)||[]).some(s=>s.strategy==='no'&&s.ticker===market.ticker));
});

test('soccer NO recovers a missed 9:00 checkpoint and enters after 60 elapsed seconds even with unchanged clock',async()=>{
  const h=harness();
  assert.equal(await h.scan(479),0,'late initial check is recorded but never an immediate order');
  assert.equal(h.orders,0);
  assert.equal(h.verifications,1);
  assert.equal(h.windows.size,1);
  assert.equal(await h.scan(479),1,'same match clock is allowed after a full real minute');
  assert.equal(h.verifications,2);
  assert.equal(h.orders,1);
});

test('soccer NO blocks final order on a missing or contradictory external reading',async()=>{
  for(const opts of [{canVerify:false},{finalExternalFails:true},{afterRefreshScore:4},{missingClock:true}]){
    const h=harness(opts);
    await h.scan(540);
    assert.equal(await h.scan(479),0,JSON.stringify(opts));
    assert.equal(h.orders,0,JSON.stringify(opts));
  }
});

test('soccer NO requires executable NO liquidity and refuses a future-dated initial proof',async()=>{
  for(const opts of [{hasSeller:false},{initialAgeMs:-1000}]){
    const h=harness(opts);await h.scan(540);
    assert.equal(await h.scan(479),0,JSON.stringify(opts));
    assert.equal(h.orders,0,JSON.stringify(opts));
  }
  const paused=harness({initialAgeMs:1000000});
  await paused.scan(540);
  assert.equal(await paused.scan(479),1,'a prolonged stoppage does not invalidate a matching fresh final check');
});

test('pending soccer NO order does not prevent first independent preflight of another market',async()=>{
 const h=harness({globalPending:true});
 assert.equal(await h.scan(540),0);
 assert.equal(h.windows.size,1,'first proof must still be recorded');
 assert.equal(h.verifications,1);
 assert.equal(await h.scan(479),0,'unresolved order must still block new execution');
 assert.equal(h.orders,0);
});

test('soccer NO cumulatively caps held exposure plus fees at five percent',async()=>{
  const h=harness({existingExposure:true});
  await h.scan(540);
  await h.scan(479);
  assert.equal(h.lastFraction,.05);
  assert.equal(h.lastBudget,50,'$5.00 cap less $4 exposure and 50-cent fees leaves 50 cents');
  assert.ok(estimatedCostCents(h.lastQuantity,.5,2)<=50,'new trade including fees fits the remaining 50 cents');
});

test('soccer NO signals are published to the dashboard without removing other strategies',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(src,/scanSoccerTotalNos\(marketGames,events,soccerNoSignals\)/);
  const begin=src.indexOf('for(const [id,candidates] of snapshotCandidates){');
  const end=src.indexOf('// Expire only the current ten-minute attempt.',begin);
  assert.ok(begin>0&&end>begin);
  const row=Array(18).fill(null);row.leadWatch=null;
  const snapshotRows=new Map([['game',row]]);
  const snapshotCandidates=new Map([['game',[]]]);
  const soccerNoSignals=new Map([['game',[{strategy:'no',ticker:market.ticker,title:market.title,execution:'Preflight pending'}]]]);
  const hockeyNoSignals=new Map([['game',[{strategy:'no',ticker:'NHL',execution:'NHL state'}]]]);
  const basketballNoSignals=new Map([['game',[{strategy:'watch',execution:'Basketball state'}]]]);
  vm.runInNewContext(src.slice(begin,end),{
    snapshotRows,snapshotCandidates,soccerNoSignals,hockeyNoSignals,basketballNoSignals,variableOverSignals:new Map(),
    crossingRows:[],filled:new Set(),account:{},balance:0,bankroll:0,signalExecution:()=>''});
  assert.deepEqual(JSON.parse(row[14]).map(s=>s.ticker||s.execution).slice(0,3),[market.ticker,'NHL','Basketball state']);
});