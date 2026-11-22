import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,goalCommandingLeadEntry,leadSignal,endWindow,leadWatchReason,kalshiSingleReadLead} from '../src/strategy.mjs';
import {nearEntryPhase,marketEntryProximity,prioritizeMarketGames} from '../src/discovery.mjs';
import {leadEntryFraction} from '../src/lead_allocation.mjs';
import {readFileSync} from 'node:fs';

const now=Date.now();
const milestone={id:'nhl-5-second-period',title:'Away at Home',type:'hockey_match',
 details:{league:'NHL',home_team_id:'home',away_team_id:'away',main_game_event_ticker:'KXNHLGAME-TEST'}};
const market={ticker:'KXNHLGAME-TEST-HOME',event_ticker:'KXNHLGAME-TEST',
 status:'active',title:'Home wins',yes_sub_title:'Home',custom_strike:{hockey_team:'home'},
 rules_primary:'Home wins the NHL game'};
const state=(goals,period,clock,extra={})=>gameState(milestone,{
 milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),
 details:{status:'inprogress',period,period_remaining_time:clock,home_score:goals,away_score:0,
   home_team_name:'Home',away_team_name:'Away',last_updated_ts:(now-1000)/1000,...extra}
});

const boundaries=[
 [5,1,'5:00',false],
 [5,2,'5:01',false],[5,2,'5:00',true],[5,2,'4:59',true],[6,2,'5:00',true],
 [4,2,'5:00',false],[4,2,'0:01',false],[5,2,'0:00',false],
 [5,3,'20:00',true],[4,3,'20:00',true],[4,3,'19:59',true],
 [3,3,'20:00',false],[3,3,'15:00',false],[3,3,'14:59',true],
 [2,3,'6:00',false],[2,3,'5:59',true],[1,3,'0:30',false],
 [5,3,'0:00',false],[5,4,'1:00',false],
];

test('NHL 5+ leads qualify in P2 at <=5:00 and remain eligible in P3; four goals at P3 start; smaller leads keep strict clock limits',()=>{
 for(const [goals,period,clock,eligible] of boundaries){
  const g=state(goals,period,clock),label='+'+goals+' P'+period+' '+clock;
  assert.equal(goalCommandingLeadEntry(g),eligible,'goal gate '+label);
  assert.equal(Boolean(leadSignal(g,market)),eligible,'exact NHL winner market '+label);
  assert.equal(endWindow(g),eligible,'entry gate '+label);
  assert.equal(kalshiSingleReadLead(g,market,now),eligible,'fresh scan '+label);
 }
});

test('NHL 5+ P2 and 4+ P3 have early fast watches and timely market priority while 3 and 2 goal watches stay correctly gated',()=>{
 for(const [goals,period,clock,label,eligible] of [
  [5,2,'6:00','+5 with 5:00 or less left in P2',false],
  [5,2,'5:00','+5 with 5:00 or less left in P2',true],
  [4,3,'20:00','+4 from the start of P3',true],
  [3,3,'16:00','+3 strictly under 15:00 in P3',false],
  [3,3,'14:59','+3 strictly under 15:00 in P3',true],
  [2,3,'7:00','+2 strictly under 6:00 in P3',false],
  [2,3,'5:59','+2 strictly under 6:00 in P3',true]
 ]){
   const g=state(goals,period,clock),watch=leadWatchReason(g);
   assert.ok(watch,'watch missing +'+goals+' P'+period+' '+clock);
   assert.ok(watch.includes(label),'watch description wrong +'+goals+' P'+period+' '+clock);
   assert.equal(/score and clock qualify/.test(watch),eligible,'qualifying watch label '+goals+' '+clock);
   assert.equal(nearEntryPhase(g),true,'period-two/three NHL prewatch must be urgent '+goals+' '+clock);
 }
 for(const [goals,period,clock] of [[5,2,'5:00'],[4,3,'20:00'],[3,3,'14:59']])
   assert.ok(marketEntryProximity(state(goals,period,clock))<0,'priority for NHL '+goals+' '+clock);
 assert.equal(leadWatchReason(state(4,2,'6:00')),null,'four-goal lead cannot enter until P3');
 assert.equal(leadWatchReason(state(5,2,'6:01')),null,'five-goal prewatch only begins in final six minutes of P2');
});

test('second-period NHL five-goal entry retains independent verification, exact contract and risk limits',()=>{
 const g=state(5,2,'5:00');
 for(const bad of [{...g,verifiedLive:false},{...g,scoreKnown:false},{...g,scoreConsistent:false},{...g,periodConsistent:false},
  {...g,feedId:'wrong'},{...g,observedAt:now-31000}])
   assert.equal(kalshiSingleReadLead(bad,market,now),false,'bad evidence must fail');
 assert.equal(leadSignal(g,{...market,custom_strike:{hockey_team:'away'}}),null,'wrong outcome rejected');
 assert.equal(leadSignal(g,{...market,title:'Home wins by 5'}),null,'margin props are not NHL winners');
 assert.equal(leadSignal({...g,period:1},market),null,'first period rejected');
 const signal=leadSignal(g,market);
 assert.equal(leadEntryFraction(g,g,signal,market,true,false),.15,'fresh independent proof capped at 15%');
 assert.equal(leadEntryFraction(g,g,signal,market,null,true),.05,'fallback remains conservative');
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(!leadFinalProofValid\(game,market\)\|\|!independentEntryValid\(game,market\)\)/,'external proof required before dispatch');
 assert.match(source,/const window=await leadFirstCheck\(game,milestone,market\)/,'first independent proof retained');
 assert.match(source,/pairedExternalMatch\(window.first_evidence,game.externalScore,game\)/,'paired independent source retained');
});

test('hockey P3 four-goal winners outrank ordinary discovery at exactly 20:00 remaining',()=>{
 const eligible=state(4,3,'20:00'),ordinary=state(1,2,'10:00');
 const result=prioritizeMarketGames([
  {milestone:{...milestone,id:'other'},state:ordinary},
  {milestone,state:eligible}
 ],{lowBudget:0,signaledIds:new Set([milestone.id])});
 assert.equal(result[0].milestone.id,milestone.id);
 assert.equal(nearEntryPhase(eligible),true);
});