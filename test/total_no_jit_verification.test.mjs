import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo,collegeFootballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function harness(sport,{ageMs=46000,failSecond=false,legacyFirstClock=null}={}){
  const basketball=sport==='NCAAB',league=basketball?'NCAAMB':sport;
  const prefix=basketball?'KXNCAAMB':sport==='NFL'?'KXNFL':'KXNCAAF';
  const period=basketball?2:4,home=basketball?65:20,away=basketball?65:17;
  const line=basketball?150:sport==='CFB'?55:52;
  const firstClock=basketball?'1:15':'5:30',entryClock=basketball?'0:29':'4:59';
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
    contract_key:overContractKey(state('1:15'),market),period,
    first_clock:legacyFirstClock,first_evidence:{source:'ESPN',seconds:legacyFirstClock},
    first_at:new Date(Date.now()-ageMs)
  },proofs=0,orders=0,blocked=false;
  const trace=[];
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  const context=vm.createContext({
    Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async()=>{
      proofs++;trace.push('external'+proofs);
      return blocked||failSecond&&proofs===2?null:{source:'ESPN',seconds:basketball?29:299,period};
    },
    pool:{query:async(sql,args=[])=>{
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
    feeReserve:()=>0,orderSize:()=>1,profitableCount:n=>n,estimatedCostCents:()=>0,
    auditTable:async()=>{},randomUUID:()=> 'proof',rememberIndependentEntry,
    reserve:async signal=>{trace.push('reserve');assert.equal(signal.fraction,basketball?.05:.10);return 'order-id';},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,basketball?.05:.10);return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const eventMap=new Map([[market.event_ticker,{category:'Sports',event_ticker:market.event_ticker,markets:[market]}]]);
  return {
    async scan(clock){return context.scanCollegeTotalNos([{milestone,state:state(clock)}],eventMap,basketball?'basketball':'football',new Map());},
    get proofs(){return proofs;},
    get orders(){return orders;},
    get window(){return window;},
    get trace(){return trace;},
    blockExternal(){blocked=true;}
  };
}

test('basketball first ESPN check starts at 1:15, 45-second real timer, then second immediately before under-30-second entry',async()=>{
  const h=harness('NCAAB');
  assert.equal(await h.scan('1:16'),0,'do not start preflight before 1:15');
  assert.equal(h.proofs,0);
  assert.equal(await h.scan('1:15'),0);
  assert.equal(h.proofs,1);
  assert.equal(h.window?.first_clock,75);
  assert.equal(h.orders,0);
  assert.equal(await h.scan('0:30'),0,'no entry at exactly thirty seconds');
  assert.equal(h.proofs,1);
  assert.equal(await h.scan('0:29'),1);
  assert.equal(h.proofs,2,'exactly two independent readings total');
  assert.equal(h.orders,1);
  assert.ok(h.trace.indexOf('external2')>h.trace.indexOf('orderbook'),'second verification must occur AFTER quote/size checks');
  assert.ok(h.trace.indexOf('external2')<h.trace.indexOf('reserve'),'second verification must occur immediately BEFORE reservation');
});

test('basketball NO fails closed when the 45-second preflight clock has not elapsed',async()=>{
  const h=harness('NCAAB',{ageMs:30000});
  assert.equal(await h.scan('1:15'),0);
  assert.equal(await h.scan('0:29'),0);
  assert.equal(h.proofs,1,'no second external lookup if countdown incomplete');
  assert.equal(h.orders,0);
});

test('basketball NO fails closed when the immediate external lookup disagrees or is unavailable',async()=>{
  const h=harness('NCAAB',{failSecond:true});
  assert.equal(await h.scan('1:15'),0);
  assert.equal(await h.scan('0:29'),0);
  assert.equal(h.proofs,2);
  assert.equal(h.orders,0);
});

test('NFL and CFB Q4 total NO each require just one external lookup, immediately before order',async()=>{
  for(const sport of ['CFB','NFL']){
    const h=harness(sport);
    assert.equal(await h.scan('5:30'),0,'no football preflight trade outside 5-minute entry window');
    assert.equal(h.proofs,0);
    assert.equal(h.window,null);
    assert.equal(await h.scan('4:59'),1,'first football score check can authorize under-five-minute entry');
    assert.equal(h.proofs,1);
    assert.equal(h.orders,1);
    assert.ok(h.trace.indexOf('external1')>h.trace.indexOf('orderbook'),sport+' external reading must follow quote/size checks');
    assert.ok(h.trace.indexOf('external1')<h.trace.indexOf('reserve'),sport+' external reading immediately before reservation');
  }
});

test('NFL and CFB NO reject the trade when their only independent check is unavailable',async()=>{
  for(const sport of ['CFB','NFL']){
    const h=harness(sport);
    h.blockExternal();
    assert.equal(await h.scan('4:59'),0);
    assert.equal(h.proofs,1);
    assert.equal(h.orders,0);
  }
});

test('stale preflight windows from earlier policies are reverified at 1:15 instead of blocking an eligible last-quarter entry',async()=>{
  for(const oldClock of [284,25]){
    const h=harness('NCAAB',{legacyFirstClock:oldClock});
    assert.equal(await h.scan('1:15'),0,'a stale preflight should be replaced, not trusted');
    assert.equal(h.proofs,1,'exactly one new first external verification');
    assert.equal(h.window?.first_clock,75,'restart the 45-second timer from a valid 1:15 preflight');
    assert.equal(await h.scan('0:29'),1,'entry after new 45-second countdown with fresh final proof');
    assert.equal(h.proofs,2);
    assert.equal(h.orders,1);
  }
});