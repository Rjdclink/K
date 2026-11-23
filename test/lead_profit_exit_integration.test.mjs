import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {threatenedLead} from '../src/lead_profit_protection.mjs';
import {eligibleProfitExit,firstProfitableLeadQuote} from '../src/profit_exits.mjs';
import {teamScorePosition} from '../src/strategy.mjs';
import {sellQuote} from '../src/sell.mjs';

const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const excerpt=src.slice(src.indexOf('async function exitComebacks('),src.indexOf('// A full discovery scan'));
const ticker='KXNHLGAME-26NOV22HOMEAWAY-HOME';
const market={ticker,event_ticker:'KXNHLGAME-26NOV22HOMEAWAY',status:'active',
  fractional_trading_enabled:true,custom_strike:{hockey_team:'home-id'},yes_sub_title:'Home'};
const milestone={id:'game-id',type:'hockey_match',title:'Home vs Away',details:{home_team_id:'home-id',away_team_id:'away-id'}};
const scores=(home,away)=>({id:'game-id',feedId:'game-id',type:'hockey_match',
  status:'live',verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
  home,away,homeUnits:home,awayUnits:away,homeTeamId:'home-id',awayTeamId:'away-id'});
const held={ticker,position_fp:'10',market_exposure_dollars:'8.80',fees_paid_dollars:'.10'};
const original={market_ticker:ticker,game_id:'game-id',sport:'Hockey',strategy:'lead',
  status:'filled',reason:'Home leads 2–0',combo_legs:null,game_family:'hockey_match'};

async function harness({score=scores(2,1),authoritative=score,position=held,price='.96',
  depth='10',watched=[],fees={multiplier:1},reversed=false}={}){
  const posts=[],writes=[],active=new Set(watched),operations=[];
  const pool={query:async(sql,args=[])=>{
    operations.push(sql);
    if(sql.includes('SELECT DISTINCT ON (market_ticker)'))return {rows:[original],rowCount:1};
    if(sql.startsWith('SELECT market_ticker FROM exit_attempts'))return {rows:[]};
    if(sql.startsWith('SELECT market_ticker FROM lead_profit_exit_watch'))return {rows:[...active].map(market_ticker=>({market_ticker}))};
    if(sql.includes('to_regclass'))return {rows:[{name:null}]};
    if(sql.includes('INSERT INTO lead_profit_exit_watch')){active.add(args[0]);writes.push(['threat',...args]);return {rows:[],rowCount:1}}
    if(sql.includes('INSERT INTO exit_attempts'))return {rows:[{id:'test-exit'}],rowCount:1};
    if(sql.includes('UPDATE exit_attempts')){writes.push(['exit',...args]);return {rows:[],rowCount:1}}
    return {rows:[],rowCount:1};
  }};
  const kalshi=async(path,opts={})=>{
    if(opts.method==='POST'){
      posts.push(opts.body);
      return {fill_count_fp:opts.body.count,order_id:'test-order'};
    }
    if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[[price,depth]]}};
    if(path.includes('/markets/'))return {market};
    throw Error('Unexpected Kalshi request '+path);
  };
  const context=vm.createContext({console,Date,Number,Math,Map,Set,JSON,
    pool,kalshi,eligibleProfitExit,firstProfitableLeadQuote,threatenedLead,teamScorePosition,sellQuote,
    isScannerExcludedSport:()=>false,
    ensureExitFills:async()=>{},ensureLeadProfitExitWatch:async()=>{},
    exitAtRiskNos:async()=>0,reconcilePendingExit:async()=>true,
    minimumCount:()=>.01,randomUUID:()=> 'test-exit',
    overCorrectionAffects:()=>false,
    profitTargetAllowed:()=>false,halfPotentialProfitExitEligible:()=>false,
    oneAndHalfExitEligible:()=>false,
    comeback:()=>reversed,
    auditedOver:async()=>true,
    externallyScoredGame:async()=>authoritative,
    liveMilestone:async()=>({}),gameState:()=>score,
    recordExitFill:async()=>{},invalidateBalance:async()=>{},
    currentFeeSpec:async()=>fees,linkedEventTickers:()=>[market.event_ticker],
  });
  vm.runInContext(excerpt,context);
  await context.exitComebacks([{milestone,state:score}],
    new Map([[market.event_ticker,{markets:[market]}]]),{market_positions:[position]});
  return {posts,writes,active,operations};
}

test('first independently corroborated one-goal threat latches and sells immediately at a net profit',async()=>{
  const result=await harness();
  assert.equal(result.active.has(ticker),true,'the threatened market must stay on watch');
  assert.equal(result.posts.length,1,'the first profitable bid should trigger a sell');
  assert.equal(result.posts[0].side,'ask');
  assert.equal(result.posts[0].time_in_force,'fill_or_kill','partial fills must not undermine the no-loss estimate');
  assert.equal(result.posts[0].reduce_only,true);
});

test('a deteriorated lead with no profitable buyer latches but does not sell at a loss',async()=>{
  const result=await harness({price:'.85'});
  assert.equal(result.active.has(ticker),true);
  assert.equal(result.posts.length,0);
});

test('a later profitable quote exits a latched position even after the lead rebounds',async()=>{
  const result=await harness({score:scores(4,2),watched:[ticker],price:'.98',authoritative:null});
  assert.equal(result.posts.length,1);
});

test('Kalshi-only score showing risk but an independent score disagreeing cannot trigger a sale',async()=>{
  const result=await harness({score:scores(2,1),authoritative:scores(3,1)});
  assert.equal(result.active.has(ticker),false);
  assert.equal(result.posts.length,0);
});

test('no automatic sale when fees are unknown or unusually high',async()=>{
  const noFees=await harness({fees:null});
  const highFees=await harness({fees:{multiplier:100}});
  assert.equal(noFees.posts.length,0);
  assert.equal(highFees.posts.length,0);
});

test('pre-existing comeback exits cannot sell lead positions below net break-even',async()=>{
  const result=await harness({score:scores(0,1),authoritative:null,reversed:true,price:'.85'});
  assert.equal(result.posts.length,0);
});

test('a held football winner eight points ahead has first-profit priority without any target percentage',async()=>{
 const football=scores(21,13);
 football.type='football_game';
 const result=await harness({score:football,authoritative:football,price:'.96'});
 assert.equal(result.posts.length,1);
 assert.equal(result.posts[0].time_in_force,'fill_or_kill');
});
test('a threatened team lead never sells an unprofitable fractional slice',async()=>{
 const result=await harness({score:scores(2,1),price:'.85',depth:'.01'});
 assert.equal(result.posts.length,0);
});
