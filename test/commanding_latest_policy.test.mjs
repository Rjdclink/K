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

test('soccer 3–0 begins at 16:30 and enters strictly below 15:30; hockey retains seven minutes',()=>{
 for(const sport of ['Soccer','NHL']){
  const limit=sport==='Soccer'?930:420;
  for(const seconds of [limit+1,limit])assert.equal(goalCommandingLeadEntry(game(sport,seconds,3)),false);
  for(const seconds of [limit-1,419,299]){
   const g=game(sport,seconds,3);
   assert.equal(goalCommandingLeadEntry(g),true);
   assert.equal(finalFiveEntryEligible(g,{strategy:'lead',market:winner}),true);
   assert.equal(finalFiveEntryEligible(g,{strategy:'no',market:no}),seconds<300);
  }
 }
 for(const seconds of [570,569]){
  assert.equal(goalCommandingLeadEntry(game('Soccer',seconds,4,1)),seconds<570);
  assert.equal(finalFiveEntryEligible(game('Soccer',seconds,4,1),{strategy:'lead',market:winner}),seconds<570);
  assert.equal(goalCommandingLeadEntry(game('Soccer',seconds,3,2)),false);
 }
 assert.equal(goalCommandingLeadEntry(game('NHL',419,4,1)),false);
 assert.equal(goalCommandingLeadEntry(game('Soccer',569,5,1)),false);
});
test('two-goal lead and NO still require strictly under five minutes; hockey four-goal lead stays there',()=>{
 for(const sport of ['Soccer','NHL']){
  assert.equal(goalCommandingLeadEntry(game(sport,300,2)),false);
  assert.equal(finalFiveEntryEligible(game(sport,300,2),{strategy:'lead',market:winner}),false);
  assert.equal(goalCommandingLeadEntry(game(sport,299,2)),true);
  assert.equal(finalFiveEntryEligible(game(sport,299,2),{strategy:'lead',market:winner}),true);
 }
 for(const seconds of [300,299]){
  assert.equal(goalCommandingLeadEntry(game('NHL',seconds,4)),seconds<300);
  assert.equal(goalCommandingLeadEntry(game('Soccer',seconds,4)),true);
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
  assert.equal(leadSignal(game(sport,sport==='Soccer'?930:420,3),market),null);
  assert.equal(Boolean(leadSignal(game(sport,299,4,1),market)),sport==='Soccer');
  assert.equal(leadSignal(game(sport,299,2),market)?.strategy,'lead');
 }
 assert.equal(goalCommandingLeadEntry({...game('NHL',200,3),period:2}),false);
});
