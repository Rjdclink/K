import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {nearEntryPhase,marketEntryProximity} from '../src/discovery.mjs';
import {soccerNoMarketSpec,soccerTotalNo,soccerStoppageNoWindow} from '../src/soccer_total_no.mjs';
import {soccerFirstHalfNo} from '../src/soccer_first_half_no.mjs';
import {NO_PREFLIGHT_POLICY,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';

const milestone={id:'game',type:'soccer_match',title:'Away at Home',start_date:'2026-11-21T14:00:00Z',
 details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV21AWAHOM'}};
function game(h,a,time="83'",half='2nd',other={}){
 return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:h,away_score:a,half,
   period:half==='1st'?1:2,time,last_updated_ts:Date.now()/1000,
   home_team_name:'Home',away_team_name:'Away',...other}});
}
function market(line,half=false){
 return {ticker:'KXEPL'+(half?'1H':'')+'TOTAL-26NOV21AWAHOM-'+Math.ceil(line),
 event_ticker:'KXEPL'+(half?'1H':'')+'TOTAL-26NOV21AWAHOM',
 title:half?'Over '+line+' 1H goals scored':'Will over '+line+' goals be scored?',
 yes_sub_title:half?'Over '+line+' 1H goals scored':'Over '+line+' goals scored',
 floor_strike:line,strike_type:'greater',status:'active',
 rules_primary:half?'If the total goals scored by Away and Home is more than '+line+' goals in the 1st Half of the Away vs Home professional EPL soccer game originally scheduled for Nov 21, 2026, then the market resolves to Yes.':
 'If over '+line+' goals are scored in the Away vs Home professional EPL soccer game originally scheduled for Nov 21, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};
}
test('before 90 full-game needs 2.5 cushion at 0–3 goals, 3.5 at four or more',()=>{
 for(const [h,a,yes,no] of [[0,0,2.5,1.5],[1,0,3.5,2.5],[1,1,4.5,3.5],
  [2,1,5.5,4.5],[2,2,7.5,6.5],[3,2,8.5,7.5],[4,2,9.5,8.5]]){
  assert.equal(soccerTotalNo(game(h,a),market(yes))?.total,h+a);
  assert.equal(soccerTotalNo(game(h,a),market(no)),null);
  assert.equal(soccerTotalNo(game(h,a),market(yes),{beforeWindow:true})?.total,h+a);
 }
});
test('first-half keeps 2.5/3.5 cushion and never uses full-time added-time exception',()=>{
 for(const [h,a,yes,no] of [[0,0,2.5,1.5],[1,0,3.5,2.5],[1,1,4.5,3.5],
  [2,1,5.5,4.5],[2,2,7.5,6.5],[3,2,8.5,7.5]]){
  assert.equal(soccerFirstHalfNo(game(h,a,"42'",'1st'),market(yes,true))?.total,h+a);
  assert.equal(soccerFirstHalfNo(game(h,a,"42'",'1st'),market(no,true)),null);
 }
 assert.equal(soccerFirstHalfNo(game(0,0,"45+2'",'1st'),market(1.5,true)),null);
});
test('live explicit 90+ stoppage allows a 1.5 cushion regardless of goal total',()=>{
 for(const [h,a,line] of [[0,0,1.5],[1,0,2.5],[1,2,4.5],[2,2,5.5],[3,2,6.5]]){
  const g=game(h,a,"90+2'");
  assert.equal(soccerStoppageNoWindow(g),true);
  assert.equal(soccerNoMarketSpec(g,market(line),{beforeWindow:true})?.line,line);
  assert.equal(soccerTotalNo(g,market(line))?.total,h+a);
  assert.equal(soccerTotalNo(g,market(line-1)),null);
 }
});
test('no entry at 90:00 without added time or in final/extra/paused/stale markets',()=>{
 const g=game(0,0,"90+2'");
 assert.equal(soccerTotalNo(game(0,0,"90'"),market(1.5)),null);
 assert.equal(soccerTotalNo(game(0,0,"90+0'"),market(1.5)),null);
 assert.equal(soccerTotalNo({...g,verifiedLive:false},market(1.5)),null);
 assert.equal(soccerTotalNo({...g,clockRunning:false},market(1.5)),null);
 assert.equal(soccerTotalNo({...g,soccerExtraTime:true},market(1.5)),null);
 assert.equal(soccerTotalNo(game(0,0,"90+2'",'extra time',{period:3}),market(1.5)),null);
 assert.equal(soccerTotalNo(g,{...market(1.5),status:'closed'}),null);
 assert.equal(soccerTotalNo({...g,observedAt:Date.now()-12000},market(1.5)),null);
});
test('stoppage-time first verification at zero clock requires a separate 30-second final verification',()=>{
 const now=Date.now(),g=game(0,0,"90+3'");
 const proof={source:'ESPN',eventId:'espn-game',preflight_policy:NO_PREFLIGHT_POLICY};
 const first={game_id:g.id,contract_key:'key',period:2,first_clock:0,
  first_evidence:proof,first_at:new Date(now-30000)};
 const context={gameId:g.id,contractKey:'key',period:2,maxFirstSeconds:660,now};
 assert.equal(validNoPreflight(first,context),false);
 assert.equal(validNoPreflight(first,{...context,allowZeroClock:soccerStoppageNoWindow(g)}),true);
 assert.equal(lateNoPreflightProgress({...first,first_at:new Date(now-29999)},now).ready,false);
 assert.equal(lateNoPreflightProgress(first,now).ready,true);
 assert.equal(validNoPreflight({...first,first_clock:-1},{...context,allowZeroClock:true}),false);
});
test('confirmed 90+ regulation stoppage is urgent for frequent market discovery',()=>{
 const g=game(0,0,"90+3'");
 assert.equal(nearEntryPhase(g),true);
 assert.ok(marketEntryProximity(g)<0,'stoppage market is not starved by early-game rotation');
 assert.equal(nearEntryPhase(game(0,0,"90'")),false);
 assert.equal(nearEntryPhase({...g,soccerExtraTime:true}),false);
 assert.equal(nearEntryPhase({...g,verifiedLive:false}),false);
});
test('independently verified scores choose the required pre-90 or 90+ cushion',()=>{
 const proof={source:'ESPN',eventId:'match-id',gameId:milestone.id,home:2,away:2,live:true};
 assert.equal(soccerTotalNo(game(1,2),market(6.5),{external:proof}),null);
 assert.equal(soccerTotalNo(game(1,2),market(7.5),{external:proof})?.total,4);
 assert.equal(soccerTotalNo(game(1,2,"90+2'"),market(5.5),{external:proof})?.total,4);
 assert.equal(soccerTotalNo(game(1,2,"90+2'"),market(4.5),{external:proof}),null);
});
