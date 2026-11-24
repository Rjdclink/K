import test from 'node:test';
import assert from 'node:assert/strict';
import {goalNoWindow} from '../src/goal_no_windows.mjs';
import {finalFiveEntryEligible} from '../src/final_five_entry.mjs';
import {rememberIndependentEntry,assertExternalPurchase} from '../src/entry_verification.mjs';

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
  clockSource,...(game.sport==='Soccer'?{elapsedMinute:clock}:{seconds:clock})},'no');
 return game;
}
test('dispatch uses the verified side, score, clock and inclusive late five-goal cap',()=>{
 for(const [sport,market,at,early] of [
  [soccer,{...soccerMarket,floor_strike:7.5},85,84.99],
  [hockey,{...hockeyMarket,floor_strike:7.5},270,271]
 ]){
  for(const [total,clock,allowed] of [[3,early,true],[4,early,false],[5,early,false],
    [4,at,true],[5,at,true],[6,at,false]]){
   const g=sport(clock);
   g.home=total-1;g.away=1;
   attach(g,market,clock);
   g.home=8;g.away=8;g.scoreKnown=false;
   const send=side=>assertExternalPurchase('/portfolio/events/orders','POST',
    {ticker:market.ticker,side},[{game:g,market}]);
   if(allowed)assert.doesNotThrow(()=>send('ask'));else assert.throws(()=>send('ask'));
   assert.throws(()=>send('bid'));
   delete g.independentEntry;
   assert.throws(()=>send('ask'));
  }
 }
});
test('only exact full-game goal-total NO lines receive the expanded windows',()=>{
 assert.equal(goalNoWindow(soccer(76),soccerMarket,3),null);
 assert.equal(goalNoWindow(hockey(850),hockeyMarket,3),null);
 assert.equal(goalNoWindow(soccer(82),{...soccerMarket,floor_strike:2.5},2),null,
  'one additional goal loses NO 2.5, so no expanded window');
 assert.deepEqual(goalNoWindow(soccer(82),{...soccerMarket,floor_strike:2.5},1),
  {firstSeconds:540,entrySeconds:480,waitSeconds:60});
 assert.deepEqual(goalNoWindow(soccer(82),{...soccerMarket,floor_strike:4.5},2),
  {firstSeconds:540,entrySeconds:480,waitSeconds:60});
 assert.equal(goalNoWindow(hockey(420),{...hockeyMarket,floor_strike:2.5},2),null);
 assert.equal(goalNoWindow(hockey(420),{...hockeyMarket,floor_strike:2.5},1)?.entrySeconds,300);
 assert.deepEqual(goalNoWindow(hockey(59),{...hockeyMarket,floor_strike:5.5},4),
  {firstSeconds:120,entrySeconds:60,waitSeconds:60});
 assert.equal(goalNoWindow(soccer(92),{...soccerMarket,floor_strike:5.5},4)?.stoppageOnly,true);
 assert.equal(goalNoWindow(soccer(76),{...soccerMarket,event_ticker:'KXEPLGAME-X'},3),null);
 assert.equal(goalNoWindow(hockey(850),{...hockeyMarket,event_ticker:'KXNHL3PTOTAL-X'},3),null);
 assert.equal(goalNoWindow(soccer(76),soccerMarket,5),null);
});
test('fresh external clock takes priority over Kalshi at the purchase boundary',()=>{
 assert.equal(finalFiveEntryEligible(attach(soccer(88),{...soccerMarket,floor_strike:5.5},83),{strategy:'no',market:{...soccerMarket,floor_strike:5.5}}),true);
 assert.equal(finalFiveEntryEligible(attach(soccer(83),{...soccerMarket,floor_strike:5.5},81),{strategy:'no',market:{...soccerMarket,floor_strike:5.5}}),false);
 assert.equal(finalFiveEntryEligible(attach(hockey(490),{...hockeyMarket,floor_strike:5.5},470),{strategy:'no',market:{...hockeyMarket,floor_strike:5.5}}),true);
 assert.equal(finalFiveEntryEligible(attach(hockey(470),{...hockeyMarket,floor_strike:5.5},490),{strategy:'no',market:{...hockeyMarket,floor_strike:5.5}}),false);
});
test('fresh Kalshi clock is used when the matched external score has no usable clock',()=>{
 assert.equal(finalFiveEntryEligible(attach(soccer(83),{...soccerMarket,floor_strike:5.5},83,'Kalshi'),{strategy:'no',market:{...soccerMarket,floor_strike:5.5}}),true);
 assert.equal(finalFiveEntryEligible(attach(hockey(470),{...hockeyMarket,floor_strike:5.5},470,'Kalshi'),{strategy:'no',market:{...hockeyMarket,floor_strike:5.5}}),true);
});
