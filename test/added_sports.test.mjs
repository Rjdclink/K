import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,additionalLeadSignal,tableTennisSignal} from '../src/strategy.mjs';
import {eligibleForMarkets,linkedEventTickers} from '../src/discovery.mjs';

const winner=(family,team='home')=>({status:'active',event_ticker:`KX${family.toUpperCase()}GAME-26OCT29`,title:'Home wins',yes_sub_title:'Home',custom_strike:{[`${family}_team`]:team}});
const clockGame=(family,lead,clock,period)=>gameState({id:family,type:`${family}_match`,title:'Away at Home',details:{home_team_id:'home',away_team_id:'away'}},{details:{status:'live',home_score:lead,away_score:0,period,period_remaining_time:clock}});
for(const [family,needed,very,window,period] of [['handball',5,8,'03:00',2],['rugby',15,22,'05:00',2],['lacrosse',4,7,'03:00',4]])test(`${family} final period lead tiers and clock boundary`,()=>{
  assert.equal(eligibleForMarkets(clockGame(family,needed,window,period)),true);
  assert.equal(additionalLeadSignal(clockGame(family,needed,window,period),winner(family))?.fraction,.10);
  assert.equal(additionalLeadSignal(clockGame(family,very,window,period),winner(family))?.fraction,.15);
  assert.equal(additionalLeadSignal(clockGame(family,needed-1,window,period),winner(family)),null);
  assert.equal(additionalLeadSignal(clockGame(family,very,window,period-1),winner(family)),null);
  assert.equal(additionalLeadSignal(clockGame(family,very,'09:00',period),winner(family)),null);
  assert.equal(additionalLeadSignal(clockGame(family,very,'',period),winner(family)),null);
});
test('rugby fixture with competitor IDs and a vs title matches its named Kalshi winner',()=>{
  const m={id:'101dedc0-3605-4c3f-ab71-378d1e93c46d',type:'rugby_match',title:'Glasgow Warriors vs Lions',details:{league:'United Rugby Championship',home_competitor_id:'glasgow-id',away_competitor_id:'lions-id'},related_event_tickers:['KXURCMATCH-26OCT301545LIOGLA']};
  const state=gameState(m,{milestone_id:m.id,details:{status:'live',home_points:19,away_points:3,period:2,period_remaining_time:'00:15'}});
  const market={status:'active',event_ticker:'KXURCMATCH-26OCT301545LIOGLA',title:'Glasgow Warriors wins',yes_sub_title:'Glasgow Warriors',custom_strike:{rugby_team:'glasgow-id'}};
  assert.equal(state.homeName,'Glasgow Warriors');
  assert.equal(state.homeTeamId,'glasgow-id');
  assert.equal(additionalLeadSignal(state,market)?.fraction,.10);
  assert.equal(additionalLeadSignal(state,{...market,custom_strike:{rugby_team:'lions-id'}}),null,'the other team cannot borrow this lead');
});
test('volleyball deciding set uses live set points and has no clock prerequisite',()=>{
  const m={id:'v',type:'volleyball_match',title:'Away at Home',details:{home_team_id:'home',away_team_id:'away'},related_event_tickers:['KXVOLLEYBALLMATCH-26OCT29']};
  const board=(home,away,period=5)=>gameState(m,{details:{status:'live',home_points:2,away_points:2,best_of:5,period,period_scores:[{type:'regular_period',number:period,home_score:home,away_score:away}]}});
  const market={...winner('volleyball'),event_ticker:'KXVOLLEYBALLMATCH-26OCT29'};
  assert.equal(linkedEventTickers(m).includes(market.event_ticker),true);
  assert.equal(additionalLeadSignal(board(12,9),market)?.fraction,.10);
  assert.equal(additionalLeadSignal(board(14,9),market)?.fraction,.15);
  assert.equal(additionalLeadSignal(board(12,10),market),null);
  assert.equal(additionalLeadSignal(board(12,9,4),market),null);
});
test('darts ticker is discovered but incomplete checkout feed cannot authorize a trade',()=>{
  const m={id:'d',type:'darts_match',title:'Away vs Home',related_event_tickers:['KXDARTSMATCH-26OCT29']};
  assert.ok(linkedEventTickers(m).includes('KXDARTSMATCH-26OCT29'));
  const state=gameState(m,{details:{status:'live',competitor1_overall_score:2,competitor2_overall_score:1}});
  assert.equal(additionalLeadSignal(state,{status:'active',event_ticker:'KXDARTSMATCH-26OCT29',title:'Home wins'}),null);
});
test('table tennis deciding seventh set uses the same clock-free point margins',()=>{
  const m={id:'tt',type:'table_tennis_match',title:'Alice vs Bob',details:{best_of:7,first_competitor_id:'a',second_competitor_id:'b'}};
  const details={status:'live',competitor1_overall_score:3,competitor2_overall_score:3,
    period_scores:[{type:'set',number:7,competitor1_score:12,competitor2_score:8}]};
  const market={status:'active',event_ticker:'KXTABLETENNISMATCH-26OCT29',title:'Alice wins',yes_sub_title:'Alice',custom_strike:{table_tennis_competitor:'a'}};
  assert.equal(tableTennisSignal(gameState(m,{details}),market)?.fraction,.10);
});
test('new sport event links in the current Kalshi milestones field are discovered',()=>{
  assert.deepEqual(linkedEventTickers({type:'darts_match',events:['KXDARTSMATCH-26OCT29']}),['KXDARTSMATCH-26OCT29']);
});
test('501 darts only qualifies a match-clinching checkout with the next throw and a double',()=>{
  const m={id:'darts',type:'darts_match',title:'Alice vs Bob',details:{format:'501',first_competitor_id:'alice',second_competitor_id:'bob'}};
  const details={status:'live',best_of_legs:5,competitor1_overall_score:2,competitor2_overall_score:1,
    competitor1_remaining_points:40,competitor2_remaining_points:250,next_throw_competitor_id:'alice',competitor1_checkout_possible:true,competitor1_on_double:true};
  const market={status:'active',event_ticker:'KXDARTSMATCH-26OCT29',title:'Alice wins',custom_strike:{darts_competitor:'alice'}};
  assert.equal(additionalLeadSignal(gameState(m,{details}),market)?.fraction,.15);
  assert.equal(additionalLeadSignal(gameState(m,{details:{...details,competitor2_remaining_points:249}}),market),null);
  assert.equal(additionalLeadSignal(gameState(m,{details:{...details,competitor1_on_double:false}}),market),null);
  assert.equal(additionalLeadSignal(gameState(m,{details:{...details,next_throw_competitor_id:'bob'}}),market),null);
});
