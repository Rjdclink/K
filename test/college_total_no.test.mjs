import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo} from '../src/no_strategy.mjs';
import {independentCollegeTotalNoReading} from '../src/college_total_no.mjs';
import {nearEntryPhase,entryEventTickers} from '../src/discovery.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const milestone={id:'ohio-akron',title:'Ohio at Akron',type:'football_game',start_date:'2026-11-04T00:00:00Z',
  details:{league:'CFB',home_team_id:'akron-id',away_team_id:'ohio-id'}};
const market=(half,line=25.5)=>({ticker:`KXNCAAF${half?'1H':''}TOTAL-TEST-${line}`,
  event_ticker:`KXNCAAF${half?'1H':''}TOTAL-TEST`,status:'active',title:`Over ${line} points`,
  floor_strike:line,strike_type:'greater',rules_primary:`The teams collectively score more than ${line} points in the ${half?'1st half of the':'full'} Ohio vs Akron college football game.`});
function state(period,clock='1:58',situation={possession_team_id:'ohio-id',side_team_id:'ohio-id',yardline:16}){
  return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'inprogress',home_points:6,away_points:7,quarter:period,clock,last_updated_ts:Date.now()/1000,situation}});
}
test('Q2 first-half and Q4 full-game NO are distinct, strict two-minute entries',()=>{
  const first=state(2),last=state(4),half=market(true),full=market(false);
  assert.equal(collegeFootballTotalNo(first,half)?.period,'first_half');
  assert.equal(collegeFootballTotalNo(last,full)?.period,'full_game');
  assert.equal(collegeFootballTotalNo(first,full),null);
  assert.equal(collegeFootballTotalNo(last,half),null);
  assert.equal(collegeFootballTotalNo(state(2,'2:00'),half),null);
  assert.ok(collegeFootballTotalNo(state(2,'2:30'),half,{beforeWindow:true}));
  assert.equal(collegeFootballTotalNo(state(2,'2:30'),half),null);
  assert.equal(nearEntryPhase(state(2,'2:30')),true);
  assert.equal(nearEntryPhase(state(4,'2:30')),true);
});
test('the market pass fetches both college football total families from a real game link',()=>{
  const linked={...milestone,details:{...milestone.details,main_game_event_ticker:'KXNCAAFGAME-26NOV03OHIOAKR'},
    related_event_tickers:['KXNCAAFGAME-26NOV03OHIOAKR','KXNCAAF1HTOTAL-26NOV03OHIOAKR','KXNCAAFTOTAL-26NOV03OHIOAKR']};
  for(const game of [state(2,'2:30'),state(4,'2:30')]){
    const tickers=entryEventTickers(linked,game);
    assert.ok(tickers.includes('KXNCAAF1HTOTAL-26NOV03OHIOAKR'));
    assert.ok(tickers.includes('KXNCAAFTOTAL-26NOV03OHIOAKR'));
  }
});
test('the football line is at least twelve above the combined score regardless of field position',()=>{
  const first=state(2),half=market(true);
  assert.equal(collegeFootballTotalNo(first,half)?.total,13);
  assert.equal(collegeFootballTotalNo(first,market(true,24.5)),null);
  assert.equal(collegeFootballTotalNo(first,{...half,title:'Over 22.5 points'}),null);
  assert.ok(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'ohio-id',side_team_id:'akron-id',yardline:16}),half));
  assert.ok(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'ohio-id',side_team_id:'ohio-id',yardline:50}),half));
  assert.ok(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'unknown',side_team_id:'unknown',yardline:16}),half));
  assert.equal(collegeFootballTotalNo(first,{...half,status:'closed'}),null);
});
test('Kalshi full-game and first-half title formats retain the exact No threshold',()=>{
  const full=market(false,25.5),half=market(true,25.5);
  assert.ok(collegeFootballTotalNo(state(4),{...full,title:'Full Game: Over 25.5 points scored',yes_sub_title:'Over 25.5 points'}));
  assert.ok(collegeFootballTotalNo(state(2),{...half,title:'Over 25.5 1H points scored',yes_sub_title:'Over 25.5 points'}));
  assert.equal(collegeFootballTotalNo(state(4),{...full,title:'Full Game: Over 24.5 points scored',yes_sub_title:'Over 24.5 points'}),null);
  assert.equal(collegeFootballTotalNo(state(4),{...full,title:'Full Game: Over 24.5 points scored',yes_sub_title:'Over 25.5 points'}),null);
});
test('the independent check requires exact ESPN score and matching period and clock',()=>{
  const game=state(2),half=market(true);
  const situation={possession:'1',downDistanceText:'2nd & 12 at OHIO 16'};
  const scoreboard={events:[{id:'401866453',date:milestone.start_date,
    competitions:[{status:{period:2,displayClock:'1:58',type:{state:'in'}},situation,
      competitors:[{id:'1',homeAway:'away',team:{displayName:'Ohio Bobcats',shortDisplayName:'Ohio',abbreviation:'OHIO'},score:'7'},
        {id:'2',homeAway:'home',team:{displayName:'Akron Zips',shortDisplayName:'Akron',abbreviation:'AKR'},score:'6'}]}]}]};
  assert.equal(independentCollegeTotalNoReading(scoreboard,game,milestone,half)?.seconds,118);
  assert.equal(independentCollegeTotalNoReading({...scoreboard,events:[{...scoreboard.events[0],competitions:[{...scoreboard.events[0].competitions[0],competitors:[{...scoreboard.events[0].competitions[0].competitors[0],score:'10'},scoreboard.events[0].competitions[0].competitors[1]]}]}]},game,milestone,half),false);
  assert.equal(independentCollegeTotalNoReading({...scoreboard,events:[{...scoreboard.events[0],competitions:[{...scoreboard.events[0].competitions[0],status:{period:2,displayClock:'1:30',type:{state:'in'}}}]}]},game,milestone,half),false);
});
test('college basketball NO uses distinct half and game contracts, thirty-point cushion and four-minute windows',()=>{
  for(const [league,prefix,halfPeriod,gamePeriod] of [
    ['NCAAMB','KXNCAAMB',1,2],['NCAAWB','KXNCAAWB',2,4]]){
    const fixture={...milestone,type:'basketball_game',title:'Away at Home',details:{league,home_team_id:'home',away_team_id:'away',
      main_game_event_ticker:`${prefix}GAME-TEST`}};
    const stateAt=(period,clock)=>gameState(fixture,{milestone_id:fixture.id,_observed_at:new Date().toISOString(),
      details:{status:'live',home_points:30,away_points:20,period,clock,last_updated_ts:Date.now()/1000,
        home_team_name:'Home',away_team_name:'Away'}});
    const contract=(half,line=80.5)=>({ticker:`${prefix}${half?'1H':''}TOTAL-TEST-${line}`,
      event_ticker:`${prefix}${half?'1H':''}TOTAL-TEST`,status:'active',title:`Over ${line} points`,
      floor_strike:line,strike_type:'greater',rules_primary:`Resolves Yes if over ${line} total points are scored in ${half?'the 1st half of ':''}the Away vs Home college basketball game.`});
    const half=contract(true),full=contract(false);
    assert.equal(collegeBasketballTotalNo(stateAt(halfPeriod,'3:59'),half)?.period,'first_half');
    assert.equal(collegeBasketballTotalNo(stateAt(gamePeriod,'3:59'),full)?.period,'full_game');
    assert.ok(collegeBasketballTotalNo(stateAt(gamePeriod,'3:59'),{
      ...full,title:'Full Game: Over 80.5 points scored',yes_sub_title:'Over 80.5 points',
      rules_primary:'If over 80.5 total points are scored in the Away vs Home college basketball game, then the market resolves to Yes.'}));
    assert.ok(collegeBasketballTotalNo(stateAt(halfPeriod,'3:59'),{
      ...half,title:'1st Half: Over 80.5 points scored',yes_sub_title:'Over 80.5 points'}));
    assert.equal(collegeBasketballTotalNo(stateAt(halfPeriod,'4:00'),half),null);
    assert.ok(collegeBasketballTotalNo(stateAt(halfPeriod,'4:30'),half,{beforeWindow:true}));
    assert.equal(collegeBasketballTotalNo(stateAt(halfPeriod,'3:59'),contract(true,79.5)),null);
    assert.equal(collegeBasketballTotalNo(stateAt(halfPeriod,'3:59'),full),null);
    assert.equal(collegeBasketballTotalNo(stateAt(gamePeriod,'3:59'),half),null);
    assert.equal(nearEntryPhase(stateAt(halfPeriod,'4:30')),true);
    const linked={...fixture,related_event_tickers:[`${prefix}GAME-TEST`]};
    assert.ok(entryEventTickers(linked,stateAt(halfPeriod,'4:30')).includes(half.event_ticker));
    assert.ok(entryEventTickers(linked,stateAt(gamePeriod,'4:30')).includes(full.event_ticker));
    const board={events:[{id:'401',date:fixture.start_date,competitions:[{status:{period:halfPeriod,displayClock:'3:59',type:{state:'in'}},
      competitors:[{id:'1',homeAway:'home',team:{displayName:'Home',abbreviation:'HOM'},score:'30'},
        {id:'2',homeAway:'away',team:{displayName:'Away',abbreviation:'AWY'},score:'20'}]}]}]};
    assert.equal(independentCollegeTotalNoReading(board,stateAt(halfPeriod,'3:59'),fixture,half)?.seconds,239);
  }
});
test('the scanner starts before 2:00 and only submits after a second fresh check and executable NO seller',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  const half=market(true),event={event_ticker:half.event_ticker,category:'Sports',markets:[half]};
  let window=null,checks=0,orders=0;const first=state(2,'2:30'),last=state(2,'1:58');
  const context=vm.createContext({Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[half.event_ticker],collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async()=>{checks++;return {source:'ESPN',seconds:118}},
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){window={market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-25000)};return {rows:[]}}
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rows:[],rowCount:1};
    }},kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.05','100']]}};
      if(path.startsWith('/markets/'))return {market:half};
      if(path==='/portfolio/events/orders'){orders++;assert.equal(opts.body.side,'ask');assert.equal(opts.body.price,'0.0500');opts.beforeDispatch();return {fill_count_fp:'10',order_id:'filled'}};
      throw Error(path);
    },liveMilestone:async()=>({milestone_id:milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_points:6,away_points:7,quarter:2,clock:'1:58',last_updated_ts:Date.now()/1000,
        situation:{possession_team_id:'ohio-id',side_team_id:'ohio-id',yardline:16}}}),gameState,
    bestNoAsk,noDepthAtAsk,minimumCount:()=>1,allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),shardCash:()=>10000,marketShard:()=>0,
    singleSpendableCash:v=>v,feeReserve:()=>0,orderSize:()=>10,profitableCount:n=>n,
    estimatedCostCents:()=>500,auditTable:async()=>{},randomUUID:()=> 'proof',
    rememberIndependentEntry,reserve:async signal=>{assert.equal(signal.fraction,.15);return 'order-1'},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,.15);return fn()},
    invalidateBalance:async()=>{}});
  vm.runInContext(code,context);
  const args=g=>[[{milestone,state:g}],new Map([[half.event_ticker,event]])];
  assert.equal(await context.scanCollegeTotalNos(...args(last),'CFB'),0,'no first check after the window opens');
  assert.equal(checks,0);
  const tooLate={...state(2,'2:05'),observedAt:Date.now()-6000};
  assert.equal(await context.scanCollegeTotalNos(...args(tooLate),'CFB'),0,'the first check must finish before the window');
  assert.equal(window,null);
  assert.equal(await context.scanCollegeTotalNos(...args(first),'CFB'),0);
  assert.equal(checks,2);assert.equal(orders,0);assert.equal(window.first_clock,150);
  assert.equal(await context.scanCollegeTotalNos(...args(last),'CFB'),1);
  assert.equal(checks,3);assert.equal(orders,1);
});
