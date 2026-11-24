import test from 'node:test';
import assert from 'node:assert/strict';
import {goalNoWindow} from '../src/goal_no_windows.mjs';
import {finalFiveEntryEligible} from '../src/final_five_entry.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

const soccerMarket={ticker:'KXEPLTOTAL-X-4',event_ticker:'KXEPLTOTAL-X',floor_strike:3.5};
const hockeyMarket={ticker:'KXNHLTOTAL-X-4',event_ticker:'KXNHLTOTAL-X',floor_strike:3.5};
const soccer=minute=>({id:'fixture-s',type:'soccer_match',sport:'Soccer',home:2,away:1,
 verifiedLive:true,scoreKnown:true,periodConsistent:true,period:2,clockRunning:true,
 soccerMinute:minute,matchRemainingSeconds:(90-minute)*60});
const hockey=seconds=>({id:'fixture-h',type:'hockey_match',sport:'NHL',home:2,away:1,
 verifiedLive:true,scoreKnown:true,periodConsistent:true,period:3,clockRunning:true,
 remainingSeconds:seconds});
function attach(game,market,clock,clockSource='ESPN'){
 game.verificationId='verified';
 rememberIndependentEntry(game,market,'verified',Date.now(),undefined,{
  source:'ESPN',eventId:'exact-fixture',period:game.period,home:game.home,away:game.away,
  clockSource,...(game.sport==='Soccer'?{elapsedMinute:clock}:{seconds:clock})});
 return game;
}
test('only exact full-game goal-total NO lines receive the expanded windows',()=>{
 assert.equal(goalNoWindow(soccer(76),soccerMarket,3)?.entrySeconds,900);
 assert.equal(goalNoWindow(hockey(850),hockeyMarket,3)?.entrySeconds,900);
 assert.equal(goalNoWindow(soccer(82),{...soccerMarket,floor_strike:2.5},2),null,
  'one additional goal loses NO 2.5, so no expanded window');
 assert.deepEqual(goalNoWindow(soccer(82),{...soccerMarket,floor_strike:4.5},2),
  {firstSeconds:540,entrySeconds:480,waitSeconds:60});
 assert.equal(goalNoWindow(hockey(420),{...hockeyMarket,floor_strike:2.5},2),null);
 assert.deepEqual(goalNoWindow(hockey(59),{...hockeyMarket,floor_strike:5.5},4),
  {firstSeconds:120,entrySeconds:60,waitSeconds:60});
 assert.equal(goalNoWindow(soccer(92),{...soccerMarket,floor_strike:5.5},4)?.stoppageOnly,true);
 assert.equal(goalNoWindow(soccer(76),{...soccerMarket,event_ticker:'KXEPLGAME-X'},3),null);
 assert.equal(goalNoWindow(hockey(850),{...hockeyMarket,event_ticker:'KXNHL3PTOTAL-X'},3),null);
 assert.equal(goalNoWindow(soccer(76),soccerMarket,5),null);
});
test('fresh external clock takes priority over Kalshi at the purchase boundary',()=>{
 assert.equal(finalFiveEntryEligible(attach(soccer(74),soccerMarket,76),{strategy:'no',market:soccerMarket}),true);
 assert.equal(finalFiveEntryEligible(attach(soccer(76),soccerMarket,74),{strategy:'no',market:soccerMarket}),false);
 assert.equal(finalFiveEntryEligible(attach(hockey(950),hockeyMarket,850),{strategy:'no',market:hockeyMarket}),true);
 assert.equal(finalFiveEntryEligible(attach(hockey(850),hockeyMarket,950),{strategy:'no',market:hockeyMarket}),false);
});
test('fresh Kalshi clock is used when the matched external score has no usable clock',()=>{
 assert.equal(finalFiveEntryEligible(attach(soccer(76),soccerMarket,76,'Kalshi'),{strategy:'no',market:soccerMarket}),true);
 assert.equal(finalFiveEntryEligible(attach(hockey(850),hockeyMarket,850,'Kalshi'),{strategy:'no',market:hockeyMarket}),true);
});
