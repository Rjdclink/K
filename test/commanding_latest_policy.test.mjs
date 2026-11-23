import test from 'node:test';
import assert from 'node:assert/strict';
import {goalCommandingLeadEntry,leadSignal} from '../src/strategy.mjs';
import {finalLeadFraction} from '../src/lead_allocation.mjs';
import {finalFiveEntryEligible,assertFinalFiveEntry} from '../src/final_five_entry.mjs';

const winner={event_ticker:'KXEPLGAME-TEST',ticker:'KXEPLGAME-TEST-HOME'};
const no={event_ticker:'KXEPLTOTAL-TEST',ticker:'KXEPLTOTAL-TEST-5'};
const game=(sport,seconds,home,away=0)=>({id:'sample',sport,
 type:sport==='Soccer'?'soccer_match':'hockey_match',verifiedLive:true,scoreKnown:true,
 scoreConsistent:true,periodConsistent:true,clockRunning:true,period:sport==='Soccer'?2:3,
 home,away,homeUnits:home,awayUnits:away,
 homeName:'Home',awayName:'Away',homeTeamId:'home-id',awayTeamId:'away-id',unit:'goals',
 ...(sport==='Soccer'?{soccerMinute:90-seconds/60,matchRemainingSeconds:seconds}:
   {remainingSeconds:seconds})});

test('three-goal soccer and hockey leads qualify strictly under seven minutes, only below five goals',()=>{
 for(const sport of ['Soccer','NHL']){
  for(const seconds of [421,420])assert.equal(goalCommandingLeadEntry(game(sport,seconds,3)),false);
  for(const seconds of [419,300,299]){
   const g=game(sport,seconds,3);
   assert.equal(goalCommandingLeadEntry(g),true);
   assert.equal(finalFiveEntryEligible(g,{strategy:'lead',market:winner}),true);
   assert.equal(finalFiveEntryEligible(g,{strategy:'no',market:no}),seconds<300);
  }
  assert.equal(goalCommandingLeadEntry(game(sport,419,4,1)),false);
 }
});
test('two-goal lead and NO require strictly under five minutes; four-goal lead also stays there',()=>{
 for(const sport of ['Soccer','NHL'])for(const margin of [2,4]){
  assert.equal(goalCommandingLeadEntry(game(sport,300,margin)),false);
  assert.equal(finalFiveEntryEligible(game(sport,300,margin),{strategy:'lead',market:winner}),false);
  assert.equal(goalCommandingLeadEntry(game(sport,299,margin)),true);
  assert.equal(finalFiveEntryEligible(game(sport,299,margin),{strategy:'lead',market:winner}),true);
 }
});
test('a total-NO order never inherits the seven-minute winner exception',()=>{
 const g=game('Soccer',360,3);
 assert.equal(finalFiveEntryEligible(g,{strategy:'lead',market:no}),false);
 assert.throws(()=>assertFinalFiveEntry([{game:g,market:no}]),
  error=>error.code==='LOCAL_FINAL_FIVE_WINDOW_REQUIRED');
});
test('the exact winner contract and verified allocation follow the new lead window',()=>{
 for(const sport of ['Soccer','NHL']){
  const g=game(sport,419,3),market={...winner,title:'Home wins',yes_sub_title:'Home',
   status:'active',custom_strike:{hockey_team:'home-id'},
   rules_primary:'Home wins after 90 minutes plus stoppage time.'};
  const signal=leadSignal(g,market);
  assert.equal(signal?.strategy,'lead');
  assert.equal(finalLeadFraction(g,g,signal,true,market),.15);
  assert.equal(leadSignal(game(sport,420,3),market),null);
  assert.equal(leadSignal(game(sport,299,4,1),market),null);
  assert.equal(leadSignal(game(sport,299,2),market)?.strategy,'lead');
 }
 assert.equal(goalCommandingLeadEntry({...game('NHL',200,3),period:2}),false);
});
