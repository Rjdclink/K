import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,leadSignal,earlyLeadSignal,kalshiOnlyLead,confirmedExternalLead,orderSize,estimatedCostCents,KALSHI_ONLY_FRACTION} from '../src/strategy.mjs';

const at=Date.now();
const milestone={id:'cfb',type:'football_game',title:'Beta at Alpha',details:{league:'CFB',
  home_team_id:'alpha',away_team_id:'beta',main_game_event_ticker:'KXNCAAFGAME-TEST'}};
const market={ticker:'KXNCAAFGAME-TEST-ALPHA',event_ticker:'KXNCAAFGAME-TEST',title:'Alpha wins',
  status:'active',custom_strike:{football_team:'alpha'},yes_ask_dollars:'.97',yes_ask_size_fp:'1000'};
function state(seconds=329,margin=10,possession='away',options={}){
  const {sport='CFB',period=4,observed=at,...extra}=options;
  return gameState({...milestone,details:{...milestone.details,league:sport}}, {
    milestone_id:'cfb',_observed_at:new Date(observed).toISOString(),details:{status:'live',period,
      clock:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,
      home_score:20+margin,away_score:20,home_team_name:'Alpha',away_team_name:'Beta',
      possession_team_id:possession==='home'?'alpha':possession==='away'?'beta':null,
      last_updated_ts:observed/1000,...extra}});
}
test('CFB permits either side or unknown possession strictly below 5:30 with ten points',()=>{
  for(const possession of ['home','away',null])assert.equal(leadSignal(state(329,10,possession),market)?.fraction,possession==='home'?.10:.05);
  for(const seconds of [330,331,419]){
    assert.equal(leadSignal(state(seconds,10,'away'),market),null);
    assert.equal(leadSignal(state(seconds,10,'home'),market)?.fraction,.10);
  }
  assert.equal(leadSignal(state(420,10,'home'),market),null);
});
test('CFB has no sub-ten-point exception, even in the final second',()=>{
  for(const margin of [0,1,7,8,9])for(const seconds of [1,19,89,179,329])for(const possession of ['home','away']){
    assert.equal(leadSignal(state(seconds,margin,possession),market),null);
    assert.equal(earlyLeadSignal(state(seconds,margin,possession),market),null);
  }
  assert.equal(leadSignal(state(0,21),market),null);
  assert.equal(leadSignal(state(89,21,'away',{period:3}),market),null);
  assert.equal(leadSignal(state(89,21),{...market,status:'closed'}),null);
  assert.equal(leadSignal(state(89,21),{...market,custom_strike:{football_team:'beta'}}),null);
  assert.equal(leadSignal(state(89,21),{...market,yes_ask_dollars:'.79'}),null);
});
test('CFB allocation increases with both margin and time, maxing at 35% only in strongest tier',()=>{
  const tiers=[{seconds:329,want:[.05,.10,.15]},{seconds:179,want:[.10,.20,.25]},{seconds:89,want:[.15,.25,.35]}];
  for(const {seconds,want} of tiers)for(const [i,margin] of [10,14,21].entries()){
    assert.equal(leadSignal(state(seconds,margin),market)?.fraction,want[i]);
  }
  assert.equal(leadSignal(state(180,21),market)?.fraction,.15);
  assert.equal(leadSignal(state(90,21),market)?.fraction,.25);
  assert.equal(leadSignal(state(89,20),market)?.fraction,.25);
  assert.equal(leadSignal(state(329,10,'home'),market)?.fraction,.10);
  assert.equal(leadSignal(state(179,14,'home'),market)?.fraction,.25);
  assert.equal(leadSignal(state(89,21,'home'),market)?.fraction,.35,'possession never exceeds the ceiling');
  for(let margin=10;margin<=50;margin++)for(const seconds of [329,180,179,90,89,1]){
    const fraction=leadSignal(state(seconds,margin),market).fraction;
    assert.ok(fraction<=.35);
    if(fraction===.35)assert.ok(margin>=21&&seconds<90);
    assert.ok(leadSignal(state(seconds,margin+1),market).fraction>=fraction);
    if(seconds>1)assert.ok(leadSignal(state(seconds-1,margin),market).fraction>=fraction);
    const fallback=Math.min(fraction,KALSHI_ONLY_FRACTION);
    const count=orderSize(10000,'.97','1000',fallback,1,10000,Infinity,2);
    assert.ok(estimatedCostCents(count,.97,2)<=1000,'fallback includes fees within 10%');
  }
});
test('CFB possession changes do not veto two qualifying fallback reads; all other verification stays',()=>{
  const first=state(102,21,'home',{observed:at-12000}),second=state(89,21,'away');
  assert.equal(kalshiOnlyLead(first,second,market),true);
  assert.equal(confirmedExternalLead(first,second,market),true);
  assert.equal(kalshiOnlyLead(first,{...second,home:42,homeUnits:42},market),false,'score change still blocks');
  assert.equal(kalshiOnlyLead(first,{...second,remainingSeconds:110},market),false,'clock reversal still blocks');
  assert.equal(kalshiOnlyLead(first,{...second,observedAt:first.observedAt+9000},market),false,'ten-second dwell remains');
  assert.equal(kalshiOnlyLead(first,{...second,feedId:'different'},market),false,'fixture identity remains');
});
test('NFL possession, allocation, and seven-point last-seconds exception stay unchanged',()=>{
  assert.equal(leadSignal(state(89,21,'away',{sport:'NFL'}),market),null);
  assert.equal(leadSignal(state(89,21,'home',{sport:'NFL'}),market)?.fraction,.15);
  assert.equal(leadSignal(state(19,7,'home',{sport:'NFL'}),market)?.fraction,.05);
  assert.equal(leadSignal(state(19,7,'away',{sport:'NFL'}),market),null);
});
