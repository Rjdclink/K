import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {verifyFreshEspnHockeyNo,validFreshEspnHockeyNo,
  pairedFreshEspnHockeyNo} from '../src/hockey_espn_no.mjs';

const milestone={id:'nhl-espn-parity',title:'Away at Home',type:'hockey_match',
  start_date:'2026-11-21T19:00:00Z',
  details:{league:'NHL',main_game_event_ticker:'KXNHLGAME-26NOV21AWAYHOME'}};
function game(period=3,clock='1:29'){
 return gameState(milestone,{milestone_id:milestone.id,
   _observed_at:new Date().toISOString(),details:{
     status:'inprogress',period,home_points:2,away_points:1,
     period_remaining_time:clock,last_updated_ts:Date.now()/1000}});
}
function board(period=3,clock='1:29',home=2,away=1){
 return {events:[{id:'nhl-external-event',date:milestone.start_date,
   competitions:[{status:{period,displayClock:clock,type:{state:'in'}},
     competitors:[
       {homeAway:'home',team:{displayName:'Home',abbreviation:'HOM'},score:String(home),
         linescores:[{value:1},{value:1},{value:0}]},
       {homeAway:'away',team:{displayName:'Away',abbreviation:'AWY'},score:String(away),
         linescores:[{value:1},{value:0},{value:0}]}
     ]}]}]};
}
const mock=(payload,age='0')=>async()=>({ok:true,headers:{get:k=>k==='age'?age:null},
  json:async()=>payload});

test('NHL NO requires fresh live ESPN-only proof with exact score, period and clock',async()=>{
 const state=game();
 const reading=await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board())});
 assert.equal(reading?.source,'ESPN');
 assert.equal(reading?.gameId,state.id);
 assert.equal(reading?.period,3);
 assert.equal(reading?.home,2);
 assert.ok(validFreshEspnHockeyNo(reading,state));
 assert.equal(await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(3,'4:30'))}),false);
 assert.equal(await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(3,'1:29',3,1))}),false);
 assert.equal(await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(4,'1:29'))}),false);
 assert.equal(await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(),'12')}),false);
 assert.equal(validFreshEspnHockeyNo({...reading,source:'FOX Sports'},state),false);
});

test('NHL ESPN two checks are separate requests, stable fixture, non-decreasing scores',async()=>{
 const state=game();
 const first=await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board())});
 const second=await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board())});
 assert.notEqual(first.requestId,second.requestId);
 assert.equal(pairedFreshEspnHockeyNo(first,second,state),true);
 assert.equal(pairedFreshEspnHockeyNo(first,first,state),false);
 assert.equal(pairedFreshEspnHockeyNo(first,{...second,eventId:'other'},state),false);
 assert.equal(pairedFreshEspnHockeyNo(first,{...second,source:'FOX Sports'},state),false);
});

test('NHL overtime ESPN confirmation is live fourth period and exact remaining clock',async()=>{
 const state=game(4,'1:29');
 const proof=await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(4,'1:29'))});
 assert.ok(validFreshEspnHockeyNo(proof,state));
 assert.equal(await verifyFreshEspnHockeyNo(state,milestone,{fetcher:mock(board(3,'1:29'))}),false);
});