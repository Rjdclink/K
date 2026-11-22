import {noFinalCheckpoint,pairedExternalMatch} from './support/no_final_checkpoint_mock.mjs';
import {noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey} from './support/no_ask_mock.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tagNoPreflight,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
import {eligibleNoFinal,launchImmediateNoFinalFixtures,immediateNoFinalProof,dueNoFinalWindows} from '../src/no_final_priority.mjs';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo,collegeFootballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function harness(sport,{ageMs=61000,failSecond=false,legacyFirstClock=null,finalEventId='jit-espn-game',unprofitable=false,retiredNo=false}={}){
  const basketball=sport==='NCAAB',league=basketball?'NCAAMB':sport;
  const prefix=basketball?'KXNCAAMB':sport==='NFL'?'KXNFL':'KXNCAAF';
  const period=basketball?2:4,home=basketball?65:20,away=basketball?65:17;
  const line=basketball?170:sport==='CFB'?57:52;
  const firstClock=basketball?'8:00':'5:30',entryClock=basketball?'6:59':'4:59';
  const milestone={id:'jit-'+sport,title:'Away at Home',
    type:basketball?'basketball_game':'football_game',start_date:'2026-11-19T12:00:00Z',
    details:{league,home_team_id:'home',away_team_id:'away',main_game_event_ticker:prefix+'GAME-TEST'}};
  const state=clock=>gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'inprogress',home_points:home,away_points:away,
      ...(basketball?{period}:{quarter:period}),clock,last_updated_ts:Date.now()/1000,
      home_team_name:'Home',away_team_name:'Away'}});
  const market={ticker:prefix+'TOTAL-TEST-'+line,event_ticker:prefix+'TOTAL-TEST',
    title:'Over '+line+' points',floor_strike:line,strike_type:'greater',status:'active',
    rules_primary:basketball?
      'Resolves Yes if over '+line+' total points are scored in the Away vs Home college basketball game.':
      'The teams collectively score more than '+line+' points in the full Away vs Home football game.'};
  let window=legacyFirstClock===null?null:{
    market_ticker:market.ticker,game_id:milestone.id,
    contract_key:overContractKey(state('8:00'),market),period,
    first_clock:legacyFirstClock,first_evidence:{source:'ESPN',eventId:'jit-espn-game',seconds:legacyFirstClock},
    first_at:new Date(Date.now()-ageMs)
  },proofs=0,orders=0,blocked=false;
  const trace=[];
  let retired=retiredNo;
  const candidateAskTimeout={...noAskTimeout,
   isRetired:async()=>retired,claimRecovery:async()=>false,
   available:async()=>{retired=false;}};
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  const context=vm.createContext({eligibleNoFinal,launchImmediateNoFinalFixtures,immediateNoFinalProof,dueNoFinalWindows,noFinalCheckpoint,noAskTimeout:candidateAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey,scheduleNoLiquidityRecheck:()=>{},recordDecision:async()=>{},pairedExternalMatch,tagNoPreflight,validNoPreflight,lateNoPreflightProgress,
    Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async game=>{
      proofs++;trace.push('external'+proofs);
      return blocked||failSecond&&proofs===2?null:{source:'ESPN',eventId:proofs>=2?finalEventId:'jit-espn-game',gameId:game.id,home:game.home,away:game.away,seconds:basketball?89:299,period};
    },
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows')&&sql.includes('game_id=ANY'))
        return {rows:window&&args[0].includes(window.game_id)&&
          Date.now()-new Date(window.first_at).getTime()>=30000?[window]:[]};
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        window={market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],
          first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-ageMs)};
        return {rowCount:1,rows:[]};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rowCount:0,rows:[]};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rowCount:1,rows:[]};
    }},
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook')){
        trace.push('orderbook');
        return {orderbook_fp:{yes_dollars:[['0.95','100']]}};
      }
      if(path.startsWith('/markets/')){trace.push('market');return {market};}
      if(path==='/portfolio/events/orders'){
        orders++;trace.push('dispatch');
        opts.beforeDispatch();
        return {fill_count_fp:'1',order_id:'filled'};
      }
      throw Error(path);
    },
    liveMilestone:async()=>({milestone_id:milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_points:home,away_points:away,
        ...(basketball?{period}:{quarter:period}),clock:entryClock,last_updated_ts:Date.now()/1000,
        home_team_name:'Home',away_team_name:'Away'}}),
    gameState,bestNoAsk,noDepthAtAsk,
    minimumCount:()=>1,allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,
    feeReserve:()=>0,orderSize:()=>1,profitableCount:n=>unprofitable?0:n,estimatedCostCents:()=>0,
    auditTable:async()=>{},randomUUID:()=> 'proof',rememberIndependentEntry,
    reserve:async signal=>{trace.push('reserve');assert.equal(signal.fraction,.15);return 'order-id';},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,.15);return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const eventMap=new Map([[market.event_ticker,{category:'Sports',event_ticker:market.event_ticker,markets:[market]}]]);
  return {
    async scan(clock,phase='all'){return context.scanCollegeTotalNos([{milestone,state:state(clock)}],eventMap,basketball?'basketball':'football',new Map(),phase);},
    get proofs(){return proofs;},
    get orders(){return orders;},
    get window(){return window;},
    get trace(){return trace;},
    blockExternal(){blocked=true;}
  };
}

test('basketball full-game first ESPN check starts at 8:00 and fresh second proof permits entry strictly under 7:00',async()=>{
  const h=harness('NCAAB');
  assert.equal(await h.scan('8:01'),0,'do not start preflight before 2:00');
  assert.equal(h.proofs,0);
  assert.equal(await h.scan('8:00'),0);
  assert.equal(h.proofs,1);
  assert.equal(h.window?.first_clock,480);
  assert.equal(h.orders,0);
  assert.equal(await h.scan('7:00'),0,'no entry at exactly seven minutes');
  assert.equal(h.proofs,1);
  assert.equal(await h.scan('6:59'),1);
  assert.equal(h.proofs,2,'exactly two independent readings total');
  assert.equal(h.orders,1);
  assert.ok(h.trace.indexOf('orderbook')<h.trace.indexOf('external2'),'second external verification MUST happen AFTER executable NO depth checks');
  assert.ok(h.trace.indexOf('external2')<h.trace.indexOf('reserve'),'second verification must occur immediately BEFORE reservation');
});

test('basketball NO requires at least 30 seconds elapsed after its first independent verification',async()=>{
  const early=harness('NCAAB',{ageMs:1000});
  assert.equal(await early.scan('8:00'),0);
  assert.equal(await early.scan('6:59'),0,'one second is not enough, regardless of match clock');
  assert.equal(early.proofs,1);
  assert.equal(early.orders,0);
  const ready=harness('NCAAB',{ageMs:30000});
  assert.equal(await ready.scan('8:00'),0);
  assert.equal(await ready.scan('6:59'),1);
  assert.equal(ready.proofs,2);
  assert.equal(ready.orders,1);
});


test('basketball NO accepts a verified same-game preflight older than five real minutes after a prolonged clock stoppage',async()=>{
  const h=harness('NCAAB',{ageMs:8*60000});
  assert.equal(await h.scan('8:00'),0,'initial independent ESPN proof recorded at 8:00');
  assert.equal(h.proofs,1);
  assert.equal(h.window?.first_clock,480);
  assert.equal(await h.scan('7:00'),0,'3:00 remains outside the entry window');
  assert.equal(await h.scan('6:59'),1,'preflight age alone must not block an eligible same-game trade');
  assert.equal(h.proofs,2,'initial proof plus fresh independent final proof must both occur');
  assert.equal(h.orders,1);
  assert.ok(h.trace.indexOf('orderbook')<h.trace.indexOf('external2'),
    'eligible final external proof requires an executable seller first');
  assert.ok(h.trace.indexOf('external2')<h.trace.indexOf('reserve'),
    'final independent evidence must precede the order reservation');
});

test('basketball NO must not combine two different ESPN game IDs even if the scores match',async()=>{
  const h=harness('NCAAB',{finalEventId:'another-espn-event'});
  assert.equal(await h.scan('8:00'),0);
  assert.equal(await h.scan('6:59'),0);
  assert.equal(h.proofs,2);
  assert.equal(h.orders,0);
});

test('basketball NO rejects an invalid future first-proof timestamp',async()=>{
  const h=harness('NCAAB',{ageMs:-60000});
  assert.equal(await h.scan('8:00'),0);
  assert.equal(await h.scan('6:59'),0);
  assert.equal(h.proofs,2,'invalid future proof forces a new independent first check, never an order');
  assert.equal(h.orders,0);
});

test('basketball NO fails closed when the immediate external lookup disagrees or is unavailable',async()=>{
  const h=harness('NCAAB',{failSecond:true});
  assert.equal(await h.scan('8:00'),0);
  assert.equal(await h.scan('6:59'),0);
  assert.equal(h.proofs,2);
  assert.equal(h.orders,0);
});

test('NFL and CFB Q4 total NO require first external proof at eligibility and second after 30 seconds',async()=>{
  for(const sport of ['CFB','NFL']){
    const early=harness(sport,{ageMs:29000});
    assert.equal(await early.scan('5:30'),0);
    assert.equal(early.proofs,1);
    assert.equal(await early.scan('4:59'),0,'29 seconds cannot enter');
    assert.equal(early.proofs,1);
    assert.equal(early.orders,0);
    const h=harness(sport,{ageMs:31000});
    assert.equal(await h.scan('5:30'),0);
    assert.equal(h.proofs,1);
    assert.ok(h.window,'first proof persists');
    assert.equal(await h.scan('4:59'),1);
    assert.equal(h.proofs,2);
    assert.equal(h.orders,1);
    assert.ok(h.trace.indexOf('orderbook')<h.trace.indexOf('external2'));
    assert.ok(h.trace.indexOf('external2')<h.trace.indexOf('reserve'));
  }
});

test('NFL and CFB NO reject the trade when the first independent check is unavailable',async()=>{
  for(const sport of ['CFB','NFL']){
    const h=harness(sport);
    h.blockExternal();
    assert.equal(await h.scan('4:59'),0);
    assert.equal(h.proofs,1);
    assert.equal(h.orders,0);
  }
});

test('stale preflight windows from earlier policies are reverified at 8:00 instead of being trusted at 2:59',async()=>{
  for(const oldClock of [481,510,600]){
    const h=harness('NCAAB',{legacyFirstClock:oldClock});
    assert.equal(await h.scan('8:00'),0,'a stale preflight should be replaced, not trusted');
    assert.equal(h.proofs,1,'exactly one new first external verification');
    assert.equal(h.window?.first_clock,480,'restart initial proof at the valid 2:00 clock');
    assert.equal(await h.scan('6:59'),1,'entry after new first proof with fresh final independent confirmation');
    assert.equal(h.proofs,2);
    assert.equal(h.orders,1);
  }
});

test('NFL, CFB and college basketball final checks preempt all new first checks',async()=>{
 for(const [sport,initialClock,entryClock] of [
  ['CFB','5:30','4:59'],['NFL','5:30','4:59'],['NCAAB','8:00','6:59']
 ]){
  const h=harness(sport);
  assert.equal(await h.scan(initialClock,'final'),0);
  assert.equal(h.proofs,0,sport+' cannot bypass first proof');
  assert.equal(await h.scan(initialClock,'initial'),0);
  assert.equal(h.proofs,1);
  assert.equal(await h.scan(entryClock,'final'),1,sport+' runs due final independently');
  assert.equal(h.proofs,2);
  assert.equal(h.orders,1);
  assert.equal(await h.scan(entryClock,'initial'),0);
  assert.equal(h.proofs,2,'no redundant final ESPN request in first lane');
 }
});

test('college football, NFL and basketball never call final ESPN when executable asks fail the net-profit floor',async()=>{
 for(const sport of ['NCAAB','CFB','NFL']){
  const h=harness(sport,{unprofitable:true});
  await h.scan(sport==='NCAAB'?'8:00':'5:30');
  assert.equal(h.proofs,1,'initial source proof retained for '+sport);
  assert.equal(await h.scan(sport==='NCAAB'?'6:59':'4:59'),0);
  assert.equal(h.proofs,1,'final external request must be suppressed by negative profit for '+sport);
  assert.equal(h.orders,0);
  assert.ok(h.trace.includes('orderbook'),'executable depth still checked for '+sport);
 }
});

test('a valid ESPN NO preflight is not permanently lost to an expired missing-orderbook timer',async()=>{
 for(const sport of ['NCAAB','CFB','NFL']){
  const h=harness(sport,{retiredNo:true});
  await h.scan(sport==='NCAAB'?'8:00':'5:30');
  assert.equal(h.proofs,1,sport+' must save its first independent proof');
  assert.equal(await h.scan(sport==='NCAAB'?'6:59':'4:59'),1,
   sport+' must recheck live NO depth despite an earlier 30-second empty book');
  assert.ok(h.trace.includes('orderbook'),sport+' must query executable depth');
  assert.equal(h.proofs,2,sport+' must still require the second independent proof');
  assert.equal(h.orders,1,sport+' may buy only after live depth and fresh ESPN proof');
 }
});
