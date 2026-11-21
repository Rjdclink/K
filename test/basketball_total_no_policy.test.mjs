import {noFinalCheckpoint,pairedExternalMatch} from './support/no_final_checkpoint_mock.mjs';
import {noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey} from './support/no_ask_mock.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tagNoPreflight,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo,collegeFootballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {overContractKey,sameSportsContract} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function basketball(league,period,clock,home=60,away=65){
  const prefix=league==='NCAAMB'?'KXNCAAMB':'KXNCAAWB';
  const milestone={id:'bb-total-no-test',title:'Away at Home',type:'basketball_game',
    start_date:'2026-11-04T00:00:00Z',
    details:{league,home_team_id:'home',away_team_id:'away',main_game_event_ticker:prefix+'GAME-TEST'}};
  const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'live',home_points:home,away_points:away,period,clock,
      last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
  return {milestone,state};
}
function totalMarket(league,half,line){
  const prefix=league==='NCAAMB'?'KXNCAAMB':'KXNCAAWB';
  return {ticker:prefix+(half?'1H':'')+'TOTAL-TEST-'+line,event_ticker:prefix+(half?'1H':'')+'TOTAL-TEST',
    status:'active',title:'Over '+line+' points',floor_strike:line,strike_type:'greater',
    rules_primary:'Resolves Yes if over '+line+' total points are scored in '+
      (half?'the 1st half of ':'')+'the Away vs Home college basketball game.'};
}

test('both college full games require 40 points strictly under 7:00; first halves retain 12 and under 1:30',()=>{
  for(const [league,halfPeriod,gamePeriod] of [['NCAAMB',1,2],['NCAAWB',2,4]]){
    for(const half of [true,false]){
      const period=half?halfPeriod:gamePeriod;
      const expanded=!half;
      const market=totalMarket(league,half,expanded?170:150);
      const at=clock=>basketball(league,period,clock,65,65).state;
      const qualifying=expanded?'6:59':'1:29',boundary=expanded?'7:00':'1:30';
      assert.equal(collegeBasketballTotalNo(at(qualifying),market)?.total,130);
      assert.ok(collegeBasketballTotalNo(at('0:01'),market));
      assert.equal(collegeBasketballTotalNo(at(boundary),market),null,'entry window is strictly under its boundary');
      assert.equal(collegeBasketballTotalNo(at('0:00'),market),null,'game or period already ended');
      assert.equal(collegeBasketballTotalNo(at(expanded?'7:29':'3:29'),market),null,'early entry window must stay closed');
      assert.equal(collegeBasketballTotalNo(at(qualifying),totalMarket(league,half,half?141.5:expanded?169.5:149.5)),null,
        'a cushion below the period-specific minimum is insufficient');
      assert.ok(collegeBasketballTotalNo(at(qualifying),totalMarket(league,half,half?142:expanded?170:150)),
        'the selected first-half or full-game minimum must qualify');
      assert.ok(collegeBasketballTotalNo(at('2:00'),market,{beforeWindow:true}),
        'first external check must be possible at its scheduled clock');
      assert.equal(collegeBasketballTotalNo(at(expanded?'8:01':'5:00'),market,{beforeWindow:true}),null);
      assert.equal(Boolean(collegeBasketballTotalNo(basketball(league,period,qualifying,66,65).state,market)),half,
        'a 19-point gap qualifies in a college first half but not the full-game 20-point rule');
    }
  }
});
test('men college full-game NO verifies at 8:00 and enters under 7:00 after 60 real seconds at 5% cap',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),
    source.indexOf('async function scan(cachedMilestones'));
  assert.ok(code.includes('async function scanCollegeTotalNos'));
  const league='NCAAMB',market=totalMarket(league,false,170);
  const first=basketball(league,2,'8:00'),last=basketball(league,2,'6:59');
  const events=new Map([[market.event_ticker,{event_ticker:market.event_ticker,
    category:'Sports',markets:[market]}]]);
  let window=null,checks=0,orders=0,reserved=null,floor=null,orderSizing=null;
  const context=vm.createContext({noFinalCheckpoint,noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey,recordDecision:async()=>{},pairedExternalMatch,tagNoPreflight,validNoPreflight,lateNoPreflightProgress,Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async game=>{checks++;return {source:'ESPN',eventId:'espn-basketball',gameId:game.id,home:game.home,away:game.away,seconds:29}}, 
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        window={market_ticker:args[0],game_id:args[1],contract_key:args[2],
          period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),
          first_at:new Date(Date.now()-61000)};
        return {rows:[]};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rows:[],rowCount:1};
    }},
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.05','100']]}};
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){
        orders++;
        assert.equal(opts.body.side,'ask');
        opts.beforeDispatch();
        return {fill_count_fp:'10',order_id:'filled'};
      }
      throw Error(path);
    },
    liveMilestone:async()=>({milestone_id:last.milestone.id,
      _observed_at:new Date().toISOString(),
      details:{status:'live',home_points:60,away_points:65,period:2,clock:'6:59',
        last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}}),
    gameState,bestNoAsk,noDepthAtAsk,minimumCount:()=>1,
    allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:(...args)=>{orderSizing=args;return 10;},
    profitableCount:n=>n,estimatedCostCents:()=>500,
    auditTable:async()=>{},randomUUID:()=> 'proof',rememberIndependentEntry,
    reserve:async signal=>{reserved=signal;return 'order-1';},
    withEntryProfitFloor:async(options,fn)=>{floor=options;return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const run=state=>context.scanCollegeTotalNos([{milestone:first.milestone,state}],events,'basketball');
  assert.equal(await run(basketball(league,2,'8:01').state),0,'wait until 8:00 to first verify');
  assert.equal(checks,0);
  assert.equal(await run(first.state),0,'first independent check only');
  assert.equal(checks,1);
  assert.equal(window?.first_clock,480);
  assert.equal(await run(basketball(league,2,'7:00').state),0,'7:00 is not entry eligible');
  assert.equal(orders,0);
  assert.equal(await run(last.state),1,'second fresh check authorizes entry immediately under 7:00');
  assert.equal(checks,2);
  assert.equal(orders,1);
  assert.equal(reserved.fraction,.05,'risk reservation must use 5%');
  assert.equal(floor.fraction,.05,'final profit validation must use 5%');
  assert.equal(orderSizing[3],.05,'per-order allocation must use 5%');
  assert.equal(orderSizing[6],500,'the aggregate 5% pool of a $10,000 bankroll is $500');
});

test('college first-half NO requires first proof at >=2:00 and enters strictly under 1:30',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),
    source.indexOf('async function scanHockeyTotalNos('));
  const early=basketball('NCAAMB',1,'2:00',65,65);
  const late=basketball('NCAAMB',1,'1:29',65,65);
  const market=totalMarket('NCAAMB',true,150);
  assert.ok(collegeBasketballTotalNo(early.state,market,{beforeWindow:true}),'first-half contract qualifies for initial external verification');
  const events=new Map([[market.event_ticker,{event_ticker:market.event_ticker,category:'Sports',markets:[market]}]]);
  let window=null,checks=0,orders=0;
  const context=vm.createContext({noFinalCheckpoint,noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey,recordDecision:async()=>{},pairedExternalMatch,tagNoPreflight,validNoPreflight,lateNoPreflightProgress,Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),linkedEventTickers:()=>[market.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async game=>{checks++;return {source:'ESPN',eventId:'espn-basketball',gameId:game.id,home:game.home,away:game.away};},
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        window={market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],
          first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-61000)};
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({milestone_id:early.milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'live',home_points:65,away_points:65,period:1,clock:'0:29',
        last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}}),
    gameState,bestNoAsk,noDepthAtAsk,
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.05','100']]}};
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){orders++;opts.beforeDispatch();return {fill_count_fp:'1',order_id:'filled'};}
      throw Error(path);
    },
    minimumCount:()=>1,allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:()=>1,profitableCount:n=>n,estimatedCostCents:()=>0,auditTable:async()=>{},
    randomUUID:()=> 'first-half-proof',rememberIndependentEntry,reserve:async()=> 'first-half-order',
    withEntryProfitFloor:async(options,fn)=>fn(),invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const scan=state=>context.scanCollegeTotalNos([{milestone:early.milestone,state}],events,'basketball');
  assert.equal(await scan(early.state),0,'first ESPN proof recorded at 2:00');
  assert.equal(orders,0);
  assert.equal(window?.first_clock,120);
  assert.equal(await scan(basketball('NCAAMB',1,'1:30').state),0,'1H requires strictly <1:30');
  assert.equal(await scan(late.state),1,'entry is allowed after an initial >=2:00 proof and fresh check under 1:30');
  assert.equal(checks,2,'initial and fresh before-dispatch verification required');
  assert.equal(orders,1);
});