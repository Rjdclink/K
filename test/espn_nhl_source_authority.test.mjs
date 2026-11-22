import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {verifyFreshEspnHockeyNo,validFreshEspnHockeyNo,pairedFreshEspnHockeyNo} from '../src/hockey_espn_no.mjs';

const milestone={id:'nhl-game-verified',type:'hockey_match',title:'Away at Home',
 start_date:'2026-11-22T12:00:00Z',details:{league:'NHL',main_game_event_ticker:'KXNHLGAME-26NOV22AWAYHOME'}};
const game=()=>gameState(milestone,{milestone_id:milestone.id,
 _observed_at:new Date().toISOString(),details:{
 status:'inprogress',period:3,home_points:2,away_points:1,
 period_remaining_time:'5:30',last_updated_ts:Date.now()/1000}});
const board=(clock='4:30',home=3,away=1)=>({events:[{id:'nhl-independent-event',date:milestone.start_date,
 competitions:[{status:{period:3,displayClock:clock,type:{state:'in',completed:false}},
 competitors:[
  {homeAway:'home',score:String(home),team:{displayName:'Home'},linescores:[{value:1},{value:1},{value:home-2}]},
  {homeAway:'away',score:String(away),team:{displayName:'Away'},linescores:[{value:1},{value:0},{value:away-1}]}
 ]}]}]});
const get=(g,b)=>verifyFreshEspnHockeyNo(g,milestone,{fetcher:async()=>({
 ok:true,headers:{get:name=>name.toLowerCase()==='age'?'0':null},json:async()=>b})});
test('NHL scoreboard score and clock are independent of Kalshi displayed values',async()=>{
 const g=game(),r=await get(g,board('4:30',3,1));
 assert.equal(r?.source,'ESPN');
 assert.deepEqual([r?.home,r?.away,r?.seconds],[3,1,270]);
 assert.equal(validFreshEspnHockeyNo(r,g),true);
});
test('the actual NHL external clock must exist and two proofs cannot run backward',async()=>{
 const g=game(),a=await get(g,board('4:30',3,1)),b=await get(g,board('5:30',3,1));
 assert.equal(pairedFreshEspnHockeyNo(a,b,g),false,'clock increases without a period change');
 assert.equal(await get(g,board('n/a',3,1)),false);
 assert.equal(await get(g,board('4:30',3,1).events.map(()=>({}))),null);
});