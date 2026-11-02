import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,tableTennisSignal,kalshiSingleReadLead,kalshiOnlyLead,confirmedExternalLead} from '../src/strategy.mjs';

const names=['Moshnikov Oleg','Kharlakin Oleg'],ids=['mos','kha'];
function fixture({bestOf=5,points=[10,5],firstIsHome=true,setNumber=bestOf,sets,status='live',at=Date.now(),selected=0}={}){
  const before=(bestOf-1)/2;
  const milestone={id:'recorded-loss',type:'table_tennis_match',title:names.join(' vs '),details:{
    league:'Russia Liga Pro',best_of:bestOf,first_competitor_id:ids[0],second_competitor_id:ids[1]}};
  const game=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(at).toISOString(),details:{
    status,last_updated_ts:(at-1000)/1000,competitor1_is_home:firstIsHome,
    home_team_name:names[firstIsHome?0:1],away_team_name:names[firstIsHome?1:0],
    competitor1_overall_score:sets?.[0]??before,competitor2_overall_score:sets?.[1]??before,
    period_scores:[{type:'set',number:setNumber,competitor1_score:points[0],competitor2_score:points[1]}]}});
  const market={ticker:'KXLIGAPROMATCH-26NOV020345MOSKHA-'+ids[selected].toUpperCase(),event_ticker:'KXLIGAPROMATCH-26NOV020345MOSKHA',
    status:'active',title:names[selected]+' wins',yes_sub_title:names[selected],custom_strike:{table_tennis_competitor:ids[selected]},yes_ask_dollars:'.98'};
  return {game,market};
}

test('ten-to-five rule is symmetric across deciding third, fifth and seventh sets without a clock',()=>{
  for(const bestOf of [3,5,7])for(const firstIsHome of [true,false])for(const selected of [0,1]){
    for(const opponent of [0,4,5,6]){
      const points=selected?[opponent,10]:[10,opponent];
      const {game,market}=fixture({bestOf,firstIsHome,selected,points});
      assert.equal(Boolean(tableTennisSignal(game,market)),opponent<=5,JSON.stringify({bestOf,firstIsHome,selected,points}));
      assert.equal(Number.isFinite(game.remainingSeconds),false,'no artificial clock is needed');
    }
  }
});

test('earlier leads, deuce, terminal scores, invalid points and non-deciding states cannot enter',()=>{
  for(const points of [[8,4],[9,5],[9,0],[10,6],[10,10],[11,5],[12,10],[10,-1]]){
    const {game,market}=fixture({points});assert.equal(tableTennisSignal(game,market),null,points.join('–'));
  }
  for(const options of [{setNumber:4},{sets:[2,1]},{status:'final'},{selected:1}]){
    const {game,market}=fixture(options);assert.equal(tableTennisSignal(game,market),null,JSON.stringify(options));
  }
});

test('recorded Moshnikov ten-to-six loss is rejected by direct, paired and external-confirmation entry paths',()=>{
  const now=Date.now();
  const {game:first,market}=fixture({points:[10,6],at:now-12000});
  const {game:second}=fixture({points:[10,6],at:now});
  assert.equal(tableTennisSignal(second,market),null);
  assert.equal(kalshiSingleReadLead(second,market,now),false);
  assert.equal(kalshiOnlyLead(first,second,market),false);
  assert.equal(confirmedExternalLead(first,second,market),false);
});

test('qualified ten-to-five entries remain available through direct and independent paired-score paths',()=>{
  const now=Date.now(),{game:first,market}=fixture({at:now-12000}),{game:second}=fixture({at:now});
  assert.equal(kalshiSingleReadLead(second,market,now),true);
  assert.equal(confirmedExternalLead(first,second,market),true);
  assert.equal(tableTennisSignal(second,{...market,custom_strike:{table_tennis_competitor:'kha'}}),null);
});
