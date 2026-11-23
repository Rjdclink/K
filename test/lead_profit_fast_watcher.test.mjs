import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {threatenedLead} from '../src/lead_profit_protection.mjs';
import {allowsNewEntry} from '../src/entry_exclusions.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const fast=source.slice(source.indexOf('async function watchCorrectedOvers('),
  source.indexOf('// Poll near-qualifying leaders'));
const ticker='KXNHLGAME-26NOV22HOMEAWAY-HOME';
const market={ticker,event_ticker:'KXNHLGAME-26NOV22HOMEAWAY',status:'active',custom_strike:{hockey_team:'home-id'}};
const state=(home,away)=>({
  id:'game-id',feedId:'game-id',type:'hockey_match',verifiedLive:true,
  scoreKnown:true,scoreConsistent:true,periodConsistent:true,
  home,away,homeUnits:home,awayUnits:away,
  homeTeamId:'home-id',awayTeamId:'away-id'
});
async function run({score=state(2,1),persisted=false,ageMinutes=1,gameStatus='live'}={}){
  const orders=[];
  const row={market_ticker:ticker,game_id:'game-id',sport:'NHL',strategy:'lead',
    game_family:'hockey_match',sport_family:'hockey_match',game_sport:'NHL',
    title:'Home vs Away',home_team_id:'home-id',away_team_id:'away-id',
    game_status:gameStatus,game_scanned_at:new Date(Date.now()-ageMinutes*60000).toISOString()};
  const pool={query:async(sql)=>{
    if(sql.includes('SELECT DISTINCT ON (a.market_ticker)'))return {rows:[row]};
    if(sql.includes('SELECT market_ticker FROM lead_profit_exit_watch'))
      return {rows:persisted?[{market_ticker:ticker}]:[]};
    return {rows:[]};
  }};
  const context=vm.createContext({Date,Number,Math,Map,Set,console,pool,allowsNewEntry,
    ensureLeadProfitExitWatch:async()=>{},supportedScannerSport:()=>true,
    kalshi:async()=>({market}),
    liveBatch:async()=>new Map([['game-id',{}]]),gameState:()=>score,
    correctionExitTargets:()=>new Set(),noNearLossScore:()=>null,
    threatenedLead,
    allOpenPositions:async()=>({market_positions:[{ticker,position_fp:'10'}]}),
    exitAtRiskNos:async()=>0,
    exitComebacks:async(_games,_events,positions)=>orders.push(...positions.market_positions)});
  vm.runInContext(fast,context);
  await context.watchCorrectedOvers(Date.now()+500);
  return orders;
}

test('a one-goal lead triggers the fast protective sell watcher',async()=>{
  assert.equal((await run()).length,1);
});
test('a safe two-goal lead does not trigger an unneeded exit quote',async()=>{
  assert.equal((await run({score:state(3,1)})).length,0);
});
test('an existing threat latch keeps the fast watcher active after a recovery',async()=>{
  assert.equal((await run({score:state(3,1),persisted:true})).length,1);
});
test('the fast watcher skips an old snapshot misclassified as live',async()=>{
  assert.equal((await run({ageMinutes:120})).length,0);
});
test('the fast watcher never treats a final game as live',async()=>{
  assert.equal((await run({gameStatus:'final'})).length,0);
});