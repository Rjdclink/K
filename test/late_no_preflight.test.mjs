import test from 'node:test';
import assert from 'node:assert/strict';
import {NO_PREFLIGHT_POLICY,NO_PREFLIGHT_MIN_SECONDS,tagNoPreflight,
  validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
const now=Date.now();
const base={market_ticker:'TOTAL',game_id:'g',contract_key:'contract',period:2,
 first_clock:460,first_evidence:{source:'ESPN',eventId:'espn-1',preflight_policy:NO_PREFLIGHT_POLICY},
 first_at:new Date(now-60000)};
test('a late first verification remains valid even if it begins under the entry time',()=>{
 assert.equal(NO_PREFLIGHT_MIN_SECONDS,60);
 assert.equal(validNoPreflight(base,{gameId:'g',contractKey:'contract',period:2,maxFirstSeconds:540,now}),true);
 assert.equal(lateNoPreflightProgress(base,now).ready,true);
 assert.equal(validNoPreflight({...base,first_clock:360},
   {gameId:'g',contractKey:'contract',period:2,maxFirstSeconds:540,now}),true);
});
test('separation is 60 seconds of ELAPSED TIME only, even when game clock is stopped',()=>{
 assert.equal(lateNoPreflightProgress({...base,first_at:new Date(now-59999)},now).ready,false);
 assert.equal(lateNoPreflightProgress({...base,first_at:new Date(now-60000)},now).ready,true);
 assert.equal(lateNoPreflightProgress({...base,first_at:new Date(now-61000)},now).ready,true);
 assert.equal(lateNoPreflightProgress({...base,first_clock:460},now).ready,true,
   'unchanged match clock must not block a second check');
 assert.equal(lateNoPreflightProgress({...base,first_clock:400},now).ready,true,
   'the clock may move independently of elapsed time');
 assert.equal(lateNoPreflightProgress({...base,first_at:new Date(now+1000)},now).ready,false);
 assert.equal(lateNoPreflightProgress(base,now).waitSeconds,0);
});
test('obsolete policy windows, future times, wrong game/contract/period and ambiguous ESPN evidence fail closed',()=>{
 assert.equal(validNoPreflight({...base,first_evidence:{source:'ESPN',eventId:'espn-1'}},
  {gameId:'g',contractKey:'contract',period:2,maxFirstSeconds:540,now}),false);
 assert.equal(validNoPreflight({...base,first_evidence:{source:'ESPN',eventId:'espn-1',preflight_policy:'late-clock-progress-60-v1'}},
  {gameId:'g',contractKey:'contract',period:2,maxFirstSeconds:540,now}),false);
 for(const window of [
  {...base,game_id:'other'}, {...base,contract_key:'other'},
  {...base,period:1}, {...base,first_clock:541},
  {...base,first_clock:0}, {...base,first_at:new Date(now+1)},
  {...base,first_evidence:{...base.first_evidence,eventId:''}},
  {...base,first_evidence:{...base.first_evidence,source:'Untrusted'}},
 ])assert.equal(validNoPreflight(window,{gameId:'g',contractKey:'contract',period:2,maxFirstSeconds:540,now}),false);
 assert.equal(tagNoPreflight({source:'ESPN',eventId:'espn-1'}).preflight_policy,NO_PREFLIGHT_POLICY);
 assert.equal(tagNoPreflight({source:'ESPN'}),null);
 assert.equal(tagNoPreflight({source:'FOX Sports',eventId:'fox-88'})?.source,'FOX Sports');
});