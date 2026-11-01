import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,cricketLeadSignal,drawSignal,confirmedDrawClock,earlyLeadSignal,kalshiOnlyLead,leadWatchReason} from '../src/strategy.mjs';
import {eligibleForMarkets} from '../src/discovery.mjs';
import {finalLeadFraction} from '../src/lead_allocation.mjs';

const at=Date.now();
const team=(type,league,home,away,extra={})=>{
  const m={id:'game',type,title:'Alpha vs Beta',details:{league,home_team_id:'alpha',away_team_id:'beta',main_game_event_ticker:'KXGAME-TEST'}};
  const market={status:'active',event_ticker:'KXGAME-TEST',ticker:'KXGAME-TEST-ALPHA',title:'Alpha wins',rules_primary:'If Alpha wins the match, then Yes.',custom_strike:{[type.split('_')[0]+'_team']:'alpha'},yes_ask_dollars:'0.95'};
  const state=(period,clock,homeScore=home,awayScore=away,other={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',period,clock,home_score:homeScore,away_score:awayScore,home_team_name:'Alpha',away_team_name:'Beta',...extra,...other}});
  return {m,market,state};
};
test('tied soccer enters strictly under 50 seconds in stoppage with the exact tie contract',()=>{
  const milestone={id:'soccer-draw',type:'soccer_match',title:'Alpha vs Beta',
    details:{league:'Soccer',main_game_event_ticker:'KXSOCCERGAME-TEST'}};
  const market={status:'active',event_ticker:'KXSOCCERGAME-TEST',ticker:'KXSOCCERGAME-TEST-TIE',
    title:'Tie',rules_primary:'Resolves Yes if Tie after 90 minutes plus stoppage time.',yes_ask_dollars:'.94'};
  const state=(seconds,more={})=>gameState(milestone,{milestone_id:milestone.id,
    _observed_at:new Date(at).toISOString(),details:{status:'live',period:2,half:'2nd',
      time:"90+3'",match_remaining_seconds:seconds,home_score:1,away_score:1,...more}});
  const first=state(49),second=state(48);
  assert.match(leadWatchReason(state(120)),/tied soccer score/);
  assert.equal(leadWatchReason(state(121)),null);
  const signal=drawSignal(first,market);
  assert.equal(drawSignal(state(50),market),null);
  assert.equal(drawSignal(state(0),market),null);
  assert.equal(signal?.fraction,.05);
  assert.equal(finalLeadFraction(first,second,signal,true,market),.05);
  assert.equal(confirmedDrawClock(first,second,market),true);
  assert.equal(confirmedDrawClock(first,state(49),market),false);
  assert.equal(drawSignal(state(49,{away_score:0}),market),null);
  assert.equal(drawSignal(state(49,{match_status:'overtime'}),market),null);
  assert.equal(drawSignal(state(49,{clock_running:false}),market),null);
  assert.equal(drawSignal(first,{...market,title:'Alpha wins'}),null);
  assert.equal(drawSignal(first,{...market,rules_primary:'Resolves Yes if Tie after extra time.'}),null);
  assert.equal(drawSignal(first,{...market,event_ticker:'OTHER-GAME'}),null);
  assert.equal(kalshiOnlyLead(first,second,market),false);
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(source,/!drawSignal\(first,ruleMarket\)/);
  assert.match(source,/drawSignal\(second,quote\)/);
});
test('Test cricket winner entries stay disabled without a finite number of balls',()=>{
  const m={id:'test',type:'cricket_match',title:'Bangladesh vs West Indies',details:{league:'Test International (M)',home_team_id:'ban',away_team_id:'wi',main_game_event_ticker:'KXTESTMATCH-TEST'}};
  const market={status:'active',event_ticker:'KXTESTMATCH-TEST',title:'Bangladesh wins',rules_primary:'If Bangladesh wins the professional Test match, then Yes.',custom_strike:{cricket_team:'ban'},yes_ask_dollars:'0.70'};
  const board={home:'Bangladesh',away:'West Indies','Current Innings':'4','Current Batting Team':'West Indies','batting.1':'Bangladesh','batting.2':'West Indies','batting.3':'Bangladesh','batting.4':'West Indies','runs.1':'272','runs.2':'245','runs.3':'79','runs.4':'40'};
  const state=(time,innings=4,changes={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date(time).toISOString(),details:{status:'live',current_inning:innings,home_score:79,away_score:40,batting:'away',home_total_runs:351,away_total_runs:285,cricket_result:{scoreboard:{...board,'Current Innings':String(innings),...changes}}}});
  const first=state(at-12000),second=state(at);
  assert.equal(eligibleForMarkets(first),true);
  assert.deepEqual([first.cricket.homeTotal,first.cricket.awayTotal],[351,285]);
  assert.equal(cricketLeadSignal(first,market),null);
  assert.equal(kalshiOnlyLead(first,second,market),false);
  assert.equal(state(at,3).cricket,null,'third innings can still extend into a fourth');
  assert.equal(cricketLeadSignal(state(at,4,{'runs.1':'270'}),market),null);
  assert.equal(cricketLeadSignal(state(at,4,{'batting.3':'unknown'}),market),null);
  assert.equal(cricketLeadSignal(first,{...market,custom_strike:{cricket_team:'wi'}}),null);
  const d20={...m,details:{...m.details,league:'Emirates D20'}};
  const chaseBoard={home:'Dubai',away:'Emirates Blues','Current Innings':'2','Current Batting Team':'Dubai','batting.1':'Emirates Blues','batting.2':'Dubai','runs.1':'167','runs.2':'89'};
  const chase=gameState(d20,{details:{status:'live',current_inning:2,home_score:89,away_score:167,batting:'home',home_total_runs:89,away_total_runs:167,cricket_result:{scoreboard:chaseBoard}}});
  assert.equal(cricketLeadSignal(chase,{...market,custom_strike:{cricket_team:'wi'},title:'Emirates Blues wins'}),null);
});
