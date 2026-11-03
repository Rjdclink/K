import test from 'node:test';
import assert from 'node:assert/strict';
import {createEntryPreparation,preparingWinner} from '../src/entry_preparation.mjs';
import {rememberIndependentEntry,independentEntryValid} from '../src/entry_verification.mjs';
import {leadSignal,overSignal,leadWatchReason} from '../src/strategy.mjs';
import {entryWindowDistance} from '../src/discovery.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const milestone={id:'g',start_date:'2026-11-03T00:00:00Z',details:{league:'NBA'}};
const market={ticker:'KXNBAGAME-G-H',event_ticker:'KXNBAGAME-G',status:'active',title:'Home wins',
  custom_strike:{basketball_team:'h'},yes_ask_dollars:'1.0000',yes_ask_size_fp:'0.00'};
const game={id:'g',feedId:'g',type:'basketball_game',sport:'NBA',home:100,away:80,homeUnits:100,awayUnits:80,
  homeTeamId:'h',awayTeamId:'a',homeName:'Home',awayName:'Away',period:4,remainingSeconds:451,
  verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,clockRunning:true,possessionSide:'home'};
function harness(decision=true){
  let time=100000,calls=0;
  const prepare=createEntryPreparation(async(g,m,{market})=>{
    calls++;if(decision===true){g.verificationId='external-'+calls;rememberIndependentEntry(g,market,g.verificationId,time)}
    return decision;
  },()=>time);
  return {prepare: (g={...game},m=market)=>prepare(g,milestone,{market:m,allowUnavailable:true}),
    get calls(){return calls},set time(v){time=v}};
}
test('a winner is verified before the clock window or seller exists, without authorizing early entry',async()=>{
  const h=harness(),first={...game};
  assert.equal(preparingWinner(first,market),true);
  assert.equal(leadSignal(first,market),null);
  assert.equal(await h.prepare(first),true);
  assert.equal(independentEntryValid(first,market,100000),true);
  const entered={...game,remainingSeconds:449};h.time=102000;
  assert.ok(leadSignal(entered,market));
  assert.equal(await h.prepare(entered),true);assert.equal(h.calls,1);
  assert.equal(entered.independentEntry.requestedAt,100000);
  assert.equal(preparingWinner(game,{...market,custom_strike:{basketball_team:'a'}}),false);
  assert.equal(preparingWinner({...game,verifiedLive:false},market),false);
});
test('score, statistic, period, clock reversal and exact contract changes discard preparation',async()=>{
  for(const change of [{home:101},{away:81},{period:3},{remainingSeconds:452},
    {playerStats:{p:{rebounds:2}}},{tennisTotal:14},{homeTeamId:'other'}]){
    const h=harness();await h.prepare();await h.prepare({...game,...change});assert.equal(h.calls,2);
  }
  for(const change of [{floor_strike:4.5},{rules_secondary:'Changed'},
    {event_ticker:'KXNBAGAME-OTHER'},{custom_strike:{basketball_team:'a'}}]){
    const h=harness();await h.prepare();await h.prepare({...game},{...market,...change});assert.equal(h.calls,2);
  }
  const h=harness();await h.prepare();h.time=110000;await h.prepare();assert.equal(h.calls,2);
});
test('a closeout clock requirement never inherits proof from before its window',async()=>{
  const h=harness(),before={...game,home:86,homeUnits:86,remainingSeconds:106};
  await h.prepare(before);await h.prepare({...before,remainingSeconds:104});assert.equal(h.calls,2);
});
test('missing or disagreeing external evidence removes previous purchase proof',async()=>{
  for(const decision of [null,false]){
    const h=harness(decision),g={...game,verificationId:'old'};
    rememberIndependentEntry(g,market,'old',100000);
    assert.equal(await h.prepare(g),decision);assert.equal(independentEntryValid(g,market,100000),false);
  }
});
test('parallel callers share one request, and an older in-flight score cannot replace a newer result',async()=>{
  let calls=0;const pending=[];
  const prepare=createEntryPreparation(async(g,m,{market})=>{
    calls++;await new Promise(resolve=>pending.push(resolve));g.verificationId='id-'+g.home;
    rememberIndependentEntry(g,market,g.verificationId,100000);return true;
  },()=>100000);
  const options={market},a={...game},b={...game},c={...game,home:101};
  const one=prepare(a,milestone,options),two=prepare(b,milestone,options);
  await Promise.resolve();assert.equal(calls,1);
  const three=prepare(c,milestone,options);await Promise.resolve();assert.equal(calls,2);
  pending[1]();assert.equal(await three,true);
  pending[0]();assert.deepEqual(await Promise.all([one,two]),[null,null]);
  assert.equal(a.independentEntry,undefined);assert.equal(c.verificationId,'id-101');
});
test('crossed player, game, team and period overs remain independent of ask availability',()=>{
  const base={...game,period:2,remainingSeconds:600,playerStats:{p:{rebounds:3}},periodScores:[{number:1,home:40,away:35}]};
  const common={status:'active',strike_type:'greater',yes_ask_dollars:'1',yes_ask_size_fp:'0'};
  for(const m of [
    {...common,ticker:'P',event_ticker:'KXNBAREB-G',title:'Pat: 3+ rebounds',floor_strike:2.5,custom_strike:{basketball_player:'p'}},
    {...common,ticker:'G',event_ticker:'KXNBATOTAL-G',title:'Over 179.5 total points',floor_strike:179.5},
    {...common,ticker:'T',event_ticker:'KXNBATEAMTOTAL-G',title:'Home over 99.5 total points',floor_strike:99.5,custom_strike:{basketball_team:'h'}},
    {...common,ticker:'Q',event_ticker:'KXNBA1QTOTAL-G',title:'Over 74.5 total points in 1st quarter',floor_strike:74.5}
  ])assert.ok(overSignal(base,m),m.ticker);
});
test('the running lead watcher verifies a waiting contract before its entry and liquidity gates',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8'),checks=[],decisions=[];
  class Clock extends Date{static now(){return 100000}}
  const context=vm.createContext({Date:Clock,console,preparingWinner,leadSignal,leadWatchReason,entryWindowDistance,
    live:()=>true,ensureLeadWatch:async()=>{},gameState:()=>({...game}),
    winnerEventTickers:()=>[market.event_ticker],
    pool:{query:async()=>({rows:[{milestone,live_score:{_observed_at:new Date(100000).toISOString()}}]})},
    marketMap:async()=>new Map([[market.event_ticker,{category:'Sports',markets:[market]}]]),
    prepareIndependentEntry:async(g,m,{market})=>{checks.push(market.ticker);return true},
    drawSignal:()=>null,earlyLeadSignal:()=>null,additionalLeadSignal:()=>null,
    recordDecision:async d=>decisions.push(d)
  });
  vm.runInContext(source.slice(source.indexOf('async function watchLeadWindows('),source.indexOf('async function watchReadyOverTickets(')),context);
  await context.watchLeadWindows(101000);
  assert.deepEqual(checks,[market.ticker]);assert.equal(decisions[0].stage,'entry_rule');
  assert.equal(decisions[0].outcome,'skipped');
});
