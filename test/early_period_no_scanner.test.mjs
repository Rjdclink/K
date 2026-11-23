import {noFinalCheckpoint,pairedExternalMatch} from './support/no_final_checkpoint_mock.mjs';
import {noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey} from './support/no_ask_mock.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tagNoPreflight,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
import {eligibleNoFinal,launchImmediateNoFinalFixtures,immediateNoFinalProof,dueNoFinalWindows} from '../src/no_final_priority.mjs';
import {readFileSync} from 'node:fs';
import {gameState,orderSize,estimatedCostCents,profitableCount} from '../src/strategy.mjs';
import {hockeyEarlyNoMarketSpec,hockeyEarlyPeriodNo} from '../src/hockey_early_period_no.mjs';
import {soccerFirstHalfNoSpec,soccerFirstHalfNo,soccerFirstHalfSeconds} from '../src/soccer_first_half_no.mjs';
import {validFreshEspnSoccerNo,pairedFreshEspnSoccerNo,SOCCER_ESPN_POLICY} from '../src/soccer_espn_no.mjs';
import {validFreshEspnHockeyNo,pairedFreshEspnHockeyNo,HOCKEY_ESPN_POLICY} from '../src/hockey_espn_no.mjs';
import {basketballEarlyQuarterNoSpec,basketballEarlyQuarterNo} from '../src/basketball_early_quarter_no.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function fixture(sport,period=1){
 const family=sport==='NHL'?'hockey_match':sport==='Soccer'?'soccer_match':'basketball_game';
 const prefix=sport==='NHL'?'KXNHL':sport==='Soccer'?'KXEPL':'KXNBA';
 const milestone={id:'early-'+sport+'-'+period,title:'Away at Home',type:family,
   start_date:new Date().toISOString(),
   details:{league:sport==='Basketball'?'NBA':sport,main_game_event_ticker:prefix+'GAME-TEST'}};
 const eventTicker=sport==='NHL'?'KXNHL'+period+'PTOTAL-TEST':
   sport==='Soccer'?'KXEPL1HTOTAL-TEST':'KXNBA'+period+'QTOTAL-TEST';
 const line=sport==='Basketball'?42.5:2.5;
 const phrase=sport==='NHL'?(period===1?'1st Period':'2nd Period'):
   sport==='Basketball'?(period===1?'1st Quarter':'2nd Quarter'):'';
 const market={ticker:eventTicker+'-'+line,event_ticker:eventTicker,
  floor_strike:line,strike_type:'greater',status:'active',
  title:sport==='Soccer'?'Over 2.5 1H goals scored':phrase+': Over '+line+
    (sport==='NHL'?' goals scored':' points scored'),
  yes_sub_title:sport==='Soccer'?'Over 2.5 1H goals scored':'Over '+line+
    (sport==='NHL'?' goals':' points'),
  rules_primary:sport==='NHL'?('If the teams collectively score more than '+line+' goals in the '+phrase+
    ' of the Away vs Home NHL game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'):
    sport==='Soccer'?('If the total goals scored by Away and Home is more than 2.5 goals in the 1st Half of the Away vs Home professional EPL soccer game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'):
    ('If over '+line+' total points are scored in the '+phrase.toLowerCase()+
      ' of the Away vs Home Pro Basketball game originally scheduled for Nov 20, 2026, then the market resolves to Yes.')
 };
 const details=(remaining,scoreDelta=0)=>{
  if(sport==='Soccer'){
   const elapsed=2700-remaining;
   return {status:'live',half:'1st',period:1,home_score:scoreDelta,
     away_score:0,time:Math.floor(elapsed/60)+':'+String(elapsed%60).padStart(2,'0')+"'",
     last_updated_ts:Date.now()/1000,home_team_name:'Away',away_team_name:'Home'};
  }
  if(sport==='NHL'){
   const parts=period===1?[{number:1,home_score:scoreDelta,away_score:0}]:
     [{number:1,home_score:1,away_score:1},{number:2,home_score:scoreDelta,away_score:0}];
   return {status:'live',period,period_remaining_time:Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0'),
     home_score:parts.reduce((n,p)=>n+p.home_score,0),away_score:parts.reduce((n,p)=>n+p.away_score,0),
     period_scores:parts,last_updated_ts:Date.now()/1000,
     home_team_name:'Away',away_team_name:'Home'};
  }
  const parts=period===1?[{number:1,home_score:15+scoreDelta,away_score:15}]:
    [{number:1,home_score:25,away_score:22},{number:2,home_score:15+scoreDelta,away_score:15}];
  return {status:'live',period,clock:Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0'),
    home_score:parts.reduce((n,p)=>n+p.home_score,0),away_score:parts.reduce((n,p)=>n+p.away_score,0),
    period_scores:parts,last_updated_ts:Date.now()/1000,
    home_team_name:'Away',away_team_name:'Home'};
 };
 const state=remaining=>gameState(milestone,{milestone_id:milestone.id,
   _observed_at:new Date().toISOString(),details:details(remaining)});
 return {milestone,market,event:{event_ticker:eventTicker,category:'Sports',markets:[market]},
   state,details};
}
function harness(sport,period=1,{firstUnavail=false,finalUnavail=false,wrongFinalSource=false,
 noSeller=false,unprofitable=false,existingExposure=false,finalScoreChanged=false,firstAgeMs=61000,globalPending=false,
 firstProofOverride=null,finalProofOverride=null}={}){
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const start=src.indexOf('async function scanEarlyPeriodNos('),end=src.indexOf('async function scanSoccerTotalNos(',start);
 assert.ok(start>0&&end>start);
 const code=src.slice(start,end),f=fixture(sport,period),trace=[];
 let verifications=0,orders=0,budget=null,fraction=null;
 const windows=new Map(),sink=new Map(),eventMap=new Map([[f.market.event_ticker,f.event]]);
 const held={ticker:'PRIOR-NO',position_fp:-1,market_exposure_dollars:'4.00',fees_paid_dollars:'0.50'};
 const proof=game=>{
   if(sport==='NHL')return {source:'ESPN',eventId:'matched-espn',live:true,
    verificationPolicy:HOCKEY_ESPN_POLICY,requestId:'independent-hockey-espn-'+verifications,
    checkedAt:Date.now(),gameId:game.id,
    period:game.period,seconds:game.remainingSeconds,home:game.home,away:game.away,
    periods:game.periodScores,currentPeriod:{home:game.periodScores[period-1].home,
      away:game.periodScores[period-1].away}};
   if(sport==='Soccer')return {source:'ESPN',verificationPolicy:SOCCER_ESPN_POLICY,
    checkedAt:Date.now(),requestId:'independent-firsthalf-espn-'+verifications,
    gameId:game.id,eventId:'matched-espn',live:true,
    period:1,home:game.home,away:game.away,elapsedMinute:game.soccerMinute};
   return {source:'ESPN',eventId:'matched-espn',live:true,quarter:period,
    seconds:game.remainingSeconds,home:game.home,away:game.away,
    parts:game.periodScores,currentQuarter:{home:game.periodScores[period-1].home,
      away:game.periodScores[period-1].away}};
 };
 const verify=async game=>{
   verifications++;trace.push('external');
   if(firstUnavail&&verifications===1||finalUnavail&&verifications>=2)return null;
   const result=proof(game);
   return {...result,source:wrongFinalSource&&verifications>=2?'FOX Sports':'ESPN',
     ...(sport==='Soccer'?(verifications===1?firstProofOverride:finalProofOverride):{})};
 };
 const table=sport==='NHL'?'nhl_early_period_no_windows':sport==='Soccer'?
   'soccer_first_half_no_windows':'basketball_early_quarter_no_windows';
 const context=vm.createContext({eligibleNoFinal,launchImmediateNoFinalFixtures,immediateNoFinalProof,dueNoFinalWindows,noFinalCheckpoint,noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey,scheduleNoLiquidityRecheck:()=>{},recordDecision:async()=>{},pairedExternalMatch,tagNoPreflight,validNoPreflight,lateNoPreflightProgress,
   Date,JSON,Math,Number,Promise,console,
   live:()=>true,liveBatch:async()=>new Map(),linkedEventTickers:()=>[f.market.event_ticker],
   hockeyEarlyNoMarketSpec,hockeyEarlyPeriodNo,validFreshEspnHockeyNo,pairedFreshEspnHockeyNo,
   soccerFirstHalfNoSpec,soccerFirstHalfNo,soccerFirstHalfSeconds,validFreshEspnSoccerNo,pairedFreshEspnSoccerNo,
   basketballEarlyQuarterNoSpec,basketballEarlyQuarterNo,
   verifyIndependentEarlyHockeyNo:verify,verifyIndependentSoccerFirstHalfNo:verify,
   verifyIndependentBasketballEarlyQuarterNo:verify,
   overContractKey,sameSportsContract,
   pool:{query:async(sql,args=[])=>{
     if(sql.startsWith('SELECT * FROM '+table)&&sql.includes('game_id=ANY')){
       return {rows:[...windows.values()].filter(w=>args[0].includes(w.game_id)&&
         Date.now()-new Date(w.first_at).getTime()>=30000)};
     }
     if(sql.startsWith('SELECT * FROM '+table)){
       return {rows:windows.has(args[0])?[windows.get(args[0])]:[]};
     }
     if(sql.startsWith('INSERT INTO '+table)){
       windows.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],
         period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),
         first_at:new Date(Date.now()-firstAgeMs)});
       return {rows:[],rowCount:1};
     }
     if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rows:globalPending&&sql.includes("WHERE strategy='no'")?[{id:'pending'}]:[],rowCount:globalPending&&sql.includes("WHERE strategy='no'")?1:0};
     if(sql.startsWith('SELECT market_ticker,fill_count,limit_price')){
       return {rows:existingExposure?[{market_ticker:held.ticker,fill_count:1,limit_price:.5,updated_at:new Date()}]:[]};
     }
     return {rows:[],rowCount:1};
   }},
   liveMilestone:async()=>({milestone_id:f.milestone.id,_observed_at:new Date().toISOString(),
     details:f.details(sport==='Basketball'?89:299,finalScoreChanged?1:0)}),
   gameState,
   kalshi:async(path,opts)=>{
     if(path.endsWith('/orderbook')){trace.push('orderbook');return {orderbook_fp:{yes_dollars:noSeller?[]:[['0.50','100']]}}}
     if(path.startsWith('/markets/'))return {market:f.market};
     if(path==='/portfolio/events/orders'){
       orders++;trace.push('order');assert.equal(opts.body.side,'ask');
       assert.equal(opts.body.time_in_force,'fill_or_kill');opts.beforeDispatch();
       return {fill_count_fp:'1',order_id:'filled'};
     }
     throw Error(path);
   },
   bestNoAsk,noDepthAtAsk,minimumCount:()=>1,
   allOpenPositions:async()=>({market_positions:existingExposure?[held]:[]}),
   accountBalance:async()=>({balance:10000,portfolio_value:0}),
   shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:x=>x,feeReserve:()=>2,
   orderSize:(cash,price,depth,pct,min,bankroll,budgetCents,fees)=>{
     fraction=pct;budget=budgetCents;return 1;
   },estimatedCostCents,profitableCount:()=>unprofitable?0:1,
   auditTable:async()=>{},randomUUID:()=> 'verified-early',rememberIndependentEntry,
   reserve:async signal=>{trace.push('reserve');assert.equal(signal.fraction,1);return 'early-order';},
   withEntryProfitFloor:async(opts,submit)=>{assert.equal(opts.fraction,1);return submit();},
   invalidateBalance:async()=>{}
 });
 vm.runInContext(code,context);
 return {
   scan:(remaining,phase='all')=>context.scanEarlyPeriodNos([{milestone:f.milestone,state:f.state(remaining)}],
     eventMap,sink,sport,phase),get windows(){return windows;},get verified(){return verifications;},
   get orders(){return orders;},get trace(){return trace;},
   get budget(){return budget;},get fraction(){return fraction;},get sink(){return sink;}
 };
}

test('first-half soccer NO rejects a second ESPN result that reuses the initial HTTP request',async()=>{
 const h=harness('Soccer',1,{finalProofOverride:{requestId:'independent-firsthalf-espn-1'}});
 await h.scan(360);
 assert.equal(h.windows.size,1);
 assert.equal(await h.scan(299),0);
 assert.equal(h.orders,0);
 assert.equal(h.verified,2);
});

test('NHL P1/P2, soccer 1H and NBA quarter NO each require initial and final verification',async()=>{
 for(const [sport,period,first,boundary] of [
   ['NHL',1,360,300],['NHL',2,360,300],
   ['Soccer',1,360,300],['Basketball',2,120,90]
 ]){
   const h=harness(sport,period);
   assert.equal(await h.scan(first),0,sport+' '+period+' first');
   assert.equal(h.windows.size,1,sport+' '+period+' initial proof');
   assert.equal(await h.scan(boundary),0,sport+' '+period+' strict entry boundary');
   assert.equal(await h.scan(boundary-1),1,sport+' '+period+' final purchase');
   assert.equal(h.verified,2,sport+' '+period+' both independent checks');
   assert.equal(h.orders,1,sport+' '+period+' exactly one order');
   assert.equal(h.fraction,1);
   assert.ok(h.trace.lastIndexOf('orderbook')<h.trace.lastIndexOf('external'),
     'final independent score check must occur AFTER executable liquidity evaluation');
   assert.ok(h.trace.lastIndexOf('external')<h.trace.indexOf('reserve'));
 }
});
test('early NHL, soccer and NBA NO permit a late first proof with an unchanged clock after 30 seconds elapsed',async()=>{
  for(const sport of ['NHL','Soccer','Basketball']){
    const h=harness(sport,1,{firstAgeMs:61000});
    const clock=sport==='Basketball'?89:299;
    assert.equal(await h.scan(clock),0,sport+' late initial proof');
    assert.equal(h.verified,1,sport+' first check');
    assert.equal(await h.scan(clock),1,sport+' final check without match-clock progression');
    assert.equal(h.verified,2,sport+' two checks');
    assert.equal(h.orders,1,sport+' order');
  }
});
test('early NHL, soccer and NBA NO block a second check until 30 seconds of elapsed time',async()=>{
  for(const sport of ['NHL','Soccer','Basketball']){
    const h=harness(sport,1,{firstAgeMs:29000});
    const clock=sport==='Basketball'?89:299;
    assert.equal(await h.scan(clock),0);
    assert.equal(await h.scan(clock),0,sport+' must not assume game-clock movement is elapsed real time');
    assert.equal(h.orders,0);
  }
});

test('missing initial preflight or a final check failure always blocks early-period NO orders',async()=>{
 for(const sport of ['NHL','Soccer','Basketball']){
   const boundary=sport==='Basketball'?90:300,first=sport==='Basketball'?120:360;
   const missed=harness(sport);
   assert.equal(await missed.scan(boundary-1),0);
   assert.equal(missed.orders,0);
   for(const opts of [{firstUnavail:true},{finalUnavail:true},{wrongFinalSource:true},
     {noSeller:true},{finalScoreChanged:true}]){
      const h=harness(sport,1,opts);
      await h.scan(first);
      assert.equal(await h.scan(boundary-1),0,sport+JSON.stringify(opts));
      assert.equal(h.orders,0,sport+JSON.stringify(opts));
   }
 }
});
test('soccer first-half NO rejects stale and inconsistent ESPN evidence at both stages',async()=>{
 for(const bad of [
  {checkedAt:Date.now()-23000},{source:'FOX Sports'},
  {live:false},{period:2},{elapsedMinute:NaN},{home:-1}
 ]){
  const first=harness('Soccer',1,{firstProofOverride:bad});
  assert.equal(await first.scan(360),0);
  assert.equal(first.windows.size,0);
  const final=harness('Soccer',1,{finalProofOverride:bad});
  assert.equal(await final.scan(360),0);
  assert.equal(final.windows.size,1);
  assert.equal(await final.scan(299),0);
  assert.equal(final.orders,0);
 }
});
test('NBA quarterly NO may start its first proof late at 1:59 but cannot order immediately',async()=>{
 const h=harness('Basketball');
 assert.equal(await h.scan(119),0);
 assert.equal(h.verified,1);
 assert.equal(h.orders,0);
 assert.equal(await h.scan(89),1);
 assert.equal(h.verified,2);
 assert.equal(h.orders,1);
});
test('global unresolved NO orders block execution but not independent early-period preflights',async()=>{
 for(const sport of ['NHL','Soccer','Basketball']){
  const h=harness(sport,1,{globalPending:true}),first=sport==='Basketball'?120:360;
  const cutoff=sport==='Basketball'?89:299;
  assert.equal(await h.scan(first),0);
  assert.equal(h.windows.size,1,sport+' preflight should be recorded');
  assert.equal(await h.scan(cutoff),0);
  assert.equal(h.orders,0,sport+' order remains blocked while previous order is unresolved');
 }
});

test('existing held NO position and paid fees reduce the new 100% allocation',async()=>{
 for(const sport of ['NHL','Soccer','Basketball']){
  const h=harness(sport,1,{existingExposure:true});
  const first=sport==='Basketball'?120:360,boundary=sport==='Basketball'?90:300;
  await h.scan(first);await h.scan(boundary-1);
  assert.equal(h.fraction,1);
  assert.equal(h.budget,9550,'$100.00 budget less $4.00 exposure and 50 cents fees leaves $95.50');
 }
});

test('early NHL, first-half soccer and NBA due finals preempt first-check work',async()=>{
 for(const sport of ['NHL','Soccer','Basketball']){
  const h=harness(sport,1),first=sport==='Basketball'?120:360,
    entry=sport==='Basketball'?89:299;
  assert.equal(await h.scan(first,'final'),0);
  assert.equal(h.verified,0);
  assert.equal(await h.scan(first,'initial'),0);
  assert.equal(h.verified,1);
  const permitted=sport==='Basketball';
  assert.equal(await h.scan(entry,'final'),permitted?1:0,
    sport+' no final trading before five minutes of GAME end');
  assert.equal(h.verified,permitted?2:1);
  assert.equal(h.orders,permitted?1:0);
  assert.equal(await h.scan(entry,'initial'),0);
  assert.equal(h.verified,permitted?2:1);
 }
});

test('NHL, soccer and NBA early NO preserve their first external proof but do not request final ESPN on an empty NO book',async()=>{
 for(const [sport,period,first,entry] of [
   ['NHL',1,360,299],['Soccer',1,360,299],['Basketball',2,120,89]
 ]){
  const h=harness(sport,period,{noSeller:true});
  assert.equal(await h.scan(first),0);
  assert.equal(h.verified,1,'first proof establishes the mandatory 30-second interval for '+sport);
  assert.equal(await h.scan(entry),0);
  assert.equal(h.verified,1,'final ESPN verification must wait until the NO orderbook has executable depth for '+sport);
  assert.equal(h.orders,0);
 }
});


test('every early-period NO family rejects negative net profit without a final ESPN request',async()=>{
 for(const [sport,period,first,entry] of [
  ['NHL',1,360,299],['Soccer',1,360,299],['Basketball',2,120,89]
 ]){
  const h=harness(sport,period,{unprofitable:true});
  assert.equal(await h.scan(first),0);
  assert.equal(h.verified,1);
  assert.equal(await h.scan(entry),0);
  assert.equal(h.verified,1,'profit floor must suppress final source verification for '+sport);
  assert.equal(h.orders,0);
 }
});