import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {collegeFootballTotalNo} from '../src/no_strategy.mjs';
import {independentCfbNoReading} from '../src/cfb_total_no.mjs';
import {nearEntryPhase} from '../src/discovery.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const milestone={id:'ohio-akron',title:'Ohio at Akron',type:'football_game',start_date:'2026-11-04T00:00:00Z',
  details:{league:'CFB',home_team_id:'akron-id',away_team_id:'ohio-id'}};
const market=(half,line=23.5)=>({ticker:`KXNCAAF${half?'1H':''}TOTAL-TEST-${line}`,
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
test('the line is at least ten above the combined score and possession is on its own side',()=>{
  const first=state(2),half=market(true);
  assert.equal(collegeFootballTotalNo(first,half)?.total,13);
  assert.equal(collegeFootballTotalNo(first,market(true,22.5)),null);
  assert.equal(collegeFootballTotalNo(first,{...half,title:'Over 22.5 points'}),null);
  assert.equal(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'ohio-id',side_team_id:'akron-id',yardline:16}),half),null);
  assert.equal(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'ohio-id',side_team_id:'ohio-id',yardline:50}),half),null);
  assert.equal(collegeFootballTotalNo(state(2,'1:58',{possession_team_id:'unknown',side_team_id:'unknown',yardline:16}),half),null);
  assert.equal(collegeFootballTotalNo(first,{...half,status:'closed'}),null);
});
test('the independent check requires exact ESPN score, clock, holder and own-side yardline',()=>{
  const game=state(2),half=market(true);
  const situation={possession:'1',downDistanceText:'2nd & 12 at OHIO 16'};
  const scoreboard={events:[{id:'401866453',date:milestone.start_date,
    competitions:[{status:{period:2,displayClock:'1:58',type:{state:'in'}},situation,
      competitors:[{id:'1',homeAway:'away',team:{displayName:'Ohio Bobcats',shortDisplayName:'Ohio',abbreviation:'OHIO'},score:'7'},
        {id:'2',homeAway:'home',team:{displayName:'Akron Zips',shortDisplayName:'Akron',abbreviation:'AKR'},score:'6'}]}]}]};
  const summary={header:{competitions:[{situation}]}};
  assert.equal(independentCfbNoReading(scoreboard,summary,game,milestone,half)?.yardline,16);
  assert.equal(independentCfbNoReading(scoreboard,{header:{competitions:[{situation:{...situation,downDistanceText:'2nd & 12 at AKR 16'}}]}},game,milestone,half),false);
  assert.equal(independentCfbNoReading(scoreboard,{header:{competitions:[{situation:{...situation,downDistanceText:'2nd & 12 at OHIO 17'}}]}},game,milestone,half),false);
  assert.equal(independentCfbNoReading(scoreboard,{header:{competitions:[{situation:{...situation,possession:'2'}}]}},game,milestone,half),false);
  assert.equal(independentCfbNoReading(scoreboard,{header:{competitions:[{}]}},game,milestone,half)?.yardline,16);
  assert.equal(independentCfbNoReading({...scoreboard,events:[{...scoreboard.events[0],competitions:[{...scoreboard.events[0].competitions[0],competitors:[{...scoreboard.events[0].competitions[0].competitors[0],score:'10'},scoreboard.events[0].competitions[0].competitors[1]]}]}]},summary,game,milestone,half),false);
});
test('the scanner starts before 2:00 and only submits after a second fresh check and executable NO seller',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeFootballTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  const half=market(true),event={event_ticker:half.event_ticker,category:'Sports',markets:[half]};
  let window=null,checks=0,orders=0;const first=state(2,'2:30'),last=state(2,'1:58');
  const context=vm.createContext({Date,JSON,Number,Math,Promise,console,live:()=>true,
    linkedEventTickers:()=>[half.event_ticker],collegeFootballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCfbNo:async()=>{checks++;return {source:'ESPN',yardline:16}},
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM cfb_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO cfb_total_no_windows')){window={market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-25000)};return {rows:[]}}
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
    rememberIndependentEntry,reserve:async()=> 'order-1',withEntryProfitFloor:async(_,fn)=>fn(),
    invalidateBalance:async()=>{}});
  vm.runInContext(code,context);
  const args=g=>[[{milestone,state:g}],new Map([[half.event_ticker,event]])];
  assert.equal(await context.scanCollegeFootballTotalNos(...args(last)),0,'no first check after the window opens');
  assert.equal(checks,0);
  const tooLate={...state(2,'2:05'),observedAt:Date.now()-6000};
  assert.equal(await context.scanCollegeFootballTotalNos(...args(tooLate)),0,'the first check must finish before the window');
  assert.equal(window,null);
  assert.equal(await context.scanCollegeFootballTotalNos(...args(first)),0);
  assert.equal(checks,2);assert.equal(orders,0);assert.equal(window.first_clock,150);
  assert.equal(await context.scanCollegeFootballTotalNos(...args(last)),1);
  assert.equal(checks,3);assert.equal(orders,1);
});
