import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,drawSignal,kalshiSingleReadLead,leadSignal,isTieOutcomeMarket} from '../src/strategy.mjs';
const states=[
 ['soccer_match','Soccer',2,{half:'2nd',time:"89:35'",home_score:2,away_score:2},'KXEPLGAME-TEST'],
 ['hockey_match','NHL',3,{period_remaining_time:'0:30',home_score:3,away_score:3},'KXNHLGAME-TEST'],
 ['basketball_game','NBA',4,{clock:'0:30',home_score:85,away_score:85},'KXNBAGAME-TEST'],
 ['football_game','NFL',4,{clock:'0:30',home_score:14,away_score:14},'KXNFLGAME-TEST']
];
test('no tied-score market authorizes any automatic lead path in any of the four sports',()=>{
 for(const [type,league,period,details,event] of states){
  const milestone={id:'tie-'+league,type,title:'Alpha vs Beta',start_date:new Date().toISOString(),details:{league,main_game_event_ticker:event}};
  const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{status:'live',period,home_team_name:'Alpha',away_team_name:'Beta',...details}});
  const market={ticker:event+'-TIE',event_ticker:event,status:'active',title:'Tie',yes_sub_title:'Tie',rules_primary:'If the game ends in a tie after regulation, resolves to Yes.',yes_ask_dollars:'.95'};
  assert.equal(isTieOutcomeMarket(market),true,league);
  assert.equal(drawSignal(state,market),null,league);
  assert.equal(leadSignal(state,market),null,league);
  assert.equal(kalshiSingleReadLead(state,market),false,league);
 }
});
test('ordinary team winner markets are never accidentally classified as ties if settlement mentions a tie refund',()=>{
 assert.equal(isTieOutcomeMarket({ticker:'KXNHLGAME-TEST-SEA',title:'Seattle wins',yes_sub_title:'Seattle',rules_primary:'If tied after regulation, this market settles under standard rules.'}),false);
 for(const label of ['Draw','Draw (90 minutes)','Tie','Tie game','Will the match be drawn?'])
  assert.equal(isTieOutcomeMarket({title:label,yes_sub_title:label}),true,label);
});
test('no automatic scanner order path or fast lead watch references drawSignal for new entries',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/drawSignal\(/);
 assert.match(src,/async function submit\([\s\S]*?if\(isTieOutcomeMarket\(market\)\)return false/);
 assert.match(src,/async function reserve\([\s\S]*?if\(isTieOutcomeMarket\(market\)\)return null/);
});