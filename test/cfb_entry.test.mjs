import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,endWindow,leadWatchReason,leadSignal,earlyLeadSignal,kalshiOnlyLead,confirmedExternalLead,orderSize,estimatedCostCents,KALSHI_ONLY_FRACTION} from '../src/strategy.mjs';
import {finalLeadFraction} from '../src/lead_allocation.mjs';

const at=Date.now();
const milestone={id:'cfb',type:'football_game',title:'Beta at Alpha',details:{league:'CFB',
  home_team_id:'alpha',away_team_id:'beta',main_game_event_ticker:'KXNCAAFGAME-TEST'}};
const market={ticker:'KXNCAAFGAME-TEST-ALPHA',event_ticker:'KXNCAAFGAME-TEST',title:'Alpha wins',
  status:'active',custom_strike:{football_team:'alpha'},yes_ask_dollars:'.97',yes_ask_size_fp:'1000'};
function state(seconds=269,margin=11,possession='away',options={}){
  const {sport='CFB',period=4,observed=at,...extra}=options;
  return gameState({...milestone,details:{...milestone.details,league:sport}}, {
    milestone_id:'cfb',_observed_at:new Date(observed).toISOString(),details:{status:'live',period,
      clock:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,
      home_score:20+margin,away_score:20,home_team_name:'Alpha',away_team_name:'Beta',
      possession_team_id:possession==='home'?'alpha':possession==='away'?'beta':null,
      last_updated_ts:observed/1000,...extra}});
}
test('CFB has no sub-eleven-point exception, even in the final second',()=>{
  for(const margin of [0,1,7,8,9,10])for(const seconds of [1,19,89,179,269])for(const possession of ['home','away']){
    assert.equal(leadSignal(state(seconds,margin,possession),market),null);
    assert.equal(earlyLeadSignal(state(seconds,margin,possession),market),null);
  }
  assert.equal(leadSignal(state(0,21),market),null);
  assert.equal(leadSignal(state(89,21,'away',{period:3}),market),null);
  assert.equal(leadSignal(state(89,21),{...market,status:'closed'}),null);
  assert.equal(leadSignal(state(89,21),{...market,custom_strike:{football_team:'beta'}}),null);
  assert.equal(leadSignal(state(89,21),{...market,yes_ask_dollars:'.79'}),null);
});
test('CFB possession changes do not veto two qualifying fallback reads; all other verification stays',()=>{
  const first=state(102,21,'home',{observed:at-12000}),second=state(89,21,'away');
  assert.equal(kalshiOnlyLead(state(451,21,'home',{observed:at-12000}),second,market),false,'both reads must be in the new window');
  assert.equal(kalshiOnlyLead(first,second,market),true);
  assert.equal(confirmedExternalLead(first,second,market),true);
  assert.equal(kalshiOnlyLead(first,{...second,home:42,homeUnits:42},market),false,'score change still blocks');
  assert.equal(kalshiOnlyLead(first,{...second,remainingSeconds:110},market),false,'clock reversal still blocks');
  assert.equal(kalshiOnlyLead(first,{...second,observedAt:first.observedAt+9000},market),false,'ten-second dwell remains');
  assert.equal(kalshiOnlyLead(first,{...second,feedId:'different'},market),false,'fixture identity remains');
});
test('CFB commanding-lead tiers include the exact clock boundary',()=>{
 for(const [margin,seconds,allowed] of [[18,450,true],[18,451,false],[17,450,false],
 [15,300,true],[15,301,false],[14,300,false],[12,270,true],[12,271,false],[11,270,false]])
  assert.equal(Boolean(leadSignal(state(seconds,margin),market)),allowed,`${margin} at ${seconds}s`);
 assert.match(leadWatchReason(state(451,18)),/18\+.*7:30 or less/);
 assert.match(leadWatchReason(state(301,15)),/15\+.*5:00 or less/);
 assert.equal(leadWatchReason(state(451,17)),null);
 assert.equal(endWindow(state(450,18)),true);
 assert.equal(endWindow(state(450,17)),false);
 const first=state(300,15,'away',{observed:at-12000}),second=state(299,15);
 assert.equal(confirmedExternalLead(first,second,market),true);
});
