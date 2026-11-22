import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,goalCommandingLeadEntry,leadSignal,leadWatchReason,endWindow,soccerWinnerWindowOpen,soccerSingleReadLead} from '../src/strategy.mjs';
import {nearEntryPhase,marketEntryProximity,prioritizeMarketGames} from '../src/discovery.mjs';

const milestone={id:'soccer-tier-boundary',type:'soccer_match',title:'Away at Home',
 details:{league:'Soccer',home_team_id:'home',away_team_id:'away',main_game_event_ticker:'KXEPLGAME-TEST'}};
const market={ticker:'KXEPLGAME-TEST-HOME',event_ticker:'KXEPLGAME-TEST',
 status:'active',title:'Home wins',yes_sub_title:'Home',
 custom_strike:{soccer_team:'home'},rules_primary:'Home wins after 90 minutes plus stoppage time.'};
const now=Date.now();
function state(margin,time,extra={}){
 return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),
  details:{status:'live',period:2,half:'2nd',home_score:margin,away_score:0,
   time,home_team_name:'Home',away_team_name:'Away',last_updated_ts:(now-1000)/1000,
   ...extra}});
}
function cases(){
 return [
  [4,"69:59'",false],[4,"70:00'",false],[4,"70:01'",true],
  [4,"74:59'",true],[4,"75:00'",true],[4,"79:59'",true],
  [3,"69:59'",false],[3,"70:01'",false],[3,"74:59'",false],
  [3,"75:00'",false],[3,"75:01'",true],[3,"79:59'",true],
  [2,"77:01'",false],[2,"83:59'",false],[2,"84:00'",false],
  [2,"84:01'",true],[2,"89:59'",true],
  [1,"89:59'",false],[4,"90:00'",false],[4,"93:00'",false],
 ];
}

test('soccer four-goal entry strictly under twenty minutes and three-goal entry strictly under fifteen, with two-goal rule unchanged',()=>{
 for(const [margin,time,allowed] of cases()){
  const s=state(margin,time);
  assert.equal(goalCommandingLeadEntry(s),allowed,'rule at +'+margin+' '+time);
  assert.equal(Boolean(leadSignal(s,market)),allowed,'market at +'+margin+' '+time);
  assert.equal(endWindow(s),allowed,'entry window at +'+margin+' '+time);
  const dispatchAllowed=allowed&&(90-s.soccerMinute)*60>5;
  if(margin>=2)assert.equal(soccerWinnerWindowOpen(s,now),dispatchAllowed,'final dispatch requires >5 real-time-equivalent seconds +'+margin+' '+time);
  assert.equal(soccerSingleReadLead(s,market,now),dispatchAllowed,'single-read proof +'+margin+' '+time);
 }
});

test('the soccer lead watcher sees both new entry tiers before their thresholds and reports accurate rules',()=>{
 for(const [margin,time,label] of [[4,"69:00'",'+4 strictly under 20:00'],[3,"74:00'",'+3 strictly under 15:00'],[2,"79:00'",'+2 strictly under 6:00']]){
  const watch=leadWatchReason(state(margin,time));
  assert.ok(watch,'fast watch before threshold +'+margin+' at '+time);
  assert.ok(watch.includes(label),label);
  assert.ok(watch.includes('waiting'),'before clock boundary is never called eligible');
 }
 for(const [margin,time] of [[4,"70:01'"],[3,"75:01'"],[2,"84:01'"]])
  assert.match(leadWatchReason(state(margin,time)),/late winner rule reached/);
 assert.equal(leadWatchReason(state(4,"68:59'")),null,'do not start the new four-goal fast watch too early');
 assert.equal(leadWatchReason(state(3,"73:59'")),null,'do not start the new three-goal fast watch too early');
});

test('priority routing promotes each new soccer entry window above unrelated discovery',()=>{
 for(const [margin,before,after] of [[4,"69:59'","70:01'"],[3,"74:59'","75:01'"]]){
  const early=state(margin,before),ready=state(margin,after);
  assert.ok(marketEntryProximity(early)>0,'not priority-ready before cutoff '+margin);
  assert.ok(marketEntryProximity(ready)<0,'priority-ready past cutoff '+margin);
  assert.ok(nearEntryPhase(ready),'new soccer entry window is in near-entry discovery '+margin);
  const sorted=prioritizeMarketGames([
   {milestone:{id:'irrelevant',type:'soccer_match',details:milestone.details},state:state(1,"62:00'")},
   {milestone, state:ready}
  ],{lowBudget:0,signaledIds:new Set([milestone.id])});
  assert.equal(sorted[0].milestone.id,milestone.id,'new qualifying lead is admitted as urgent');
 }
});

test('the earlier soccer entry windows do not waive stale-score, regulation, fixture or draw safeguards',()=>{
 const allowed=state(4,"70:01'");
 assert.equal(soccerSingleReadLead({...allowed,clockRunning:false},market,now),false,'stopped clock');
 assert.equal(soccerSingleReadLead({...allowed,scoreConsistent:false},market,now),false,'score mismatch');
 assert.equal(soccerSingleReadLead({...allowed,feedId:'other'},market,now),false,'unlinked fixture');
 assert.equal(soccerSingleReadLead({...allowed,observedAt:now-31000},market,now),false,'stale score');
 assert.equal(goalCommandingLeadEntry({...allowed,soccerExtraTime:true}),false,'extra time');
 assert.equal(goalCommandingLeadEntry({...allowed,period:1}),false,'first half');
 assert.equal(soccerSingleReadLead(allowed,{...market,custom_strike:{soccer_team:'away'}},now),false,'wrong selected team');
 const draw={...market,title:'Tie',yes_sub_title:'Tie'};
 assert.equal(soccerSingleReadLead(allowed,draw,now),false,'draw');
 assert.equal(goalCommandingLeadEntry({...allowed,clockRunning:false}),false,'paused clock');
});