import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finalLeadFraction,leaderHasControl} from '../src/lead_allocation.mjs';
import {gameState,earlyLeadSignal} from '../src/strategy.mjs';

const lead={strategy:'lead',fraction:.15};
const game=(type,possessionSide='home')=>({type,sport:'Other',home:30,away:10,homeUnits:30,awayUnits:10,possessionSide});
test('winner allocations are uniform after independent verification',()=>{
  for(const type of ['basketball_game','hockey_match','football_game','baseball_game','rugby_match','handball_match','lacrosse_game','table_tennis_match']){
    const g=game(type);
    assert.equal(finalLeadFraction(g,g,lead,true),.20,type);
    assert.equal(finalLeadFraction(g,g,lead,false),.10,type+' fallback cap');
    assert.equal(finalLeadFraction({...g,possessionSide:null},g,lead,true),.20,'both observations must establish control');
    assert.equal(finalLeadFraction(g,{...g,possessionSide:'away'},lead,true),.20);
  }
  const volleyball={...game('volleyball_match'),homeUnits:2,awayUnits:2,volleyball:{current:{home:14,away:10}}};
  assert.equal(finalLeadFraction(volleyball,volleyball,lead,true),.20);
  const golf={type:'golf_tournament',golf:{}};
  assert.equal(finalLeadFraction(golf,golf,{...lead,fraction:.10},true),.20,'golf has no possession bonus');
});
test('rugby competitor IDs can identify the leader in possession without guessing',()=>{
  const milestone={id:'rugby',type:'rugby_match',title:'Home vs Away',details:{league:'United Rugby Championship',
    home_competitor_id:'home-id',away_competitor_id:'away-id'}};
  const live={milestone_id:'rugby',details:{status:'live',period:2,clock:'00:38',home_score:0,away_score:19,
    possession_team_id:'away-id'}};
  const state=gameState(milestone,live);
  assert.equal(state.possessionSide,'away');
  assert.equal(leaderHasControl(state),true);
  assert.equal(gameState(milestone,{...live,details:{...live.details,possession_team_id:'unrecognized'}}).possessionSide,null);
});
test('tennis serve, table-tennis serve, and darts turn must identify the leading competitor',()=>{
  for(const type of ['tennis_match','table_tennis_match']){
    const g=gameState({id:'g',type,title:'Alpha vs Beta',details:{first_competitor_id:'a',second_competitor_id:'b'}},
      {details:{status:'live',server:'a',home_score:5,away_score:4,competitor1_round_scores:[{score:5}],competitor2_round_scores:[{score:4}],period_scores:[{type:'set',number:5,competitor1_score:10,competitor2_score:5}]}});
    assert.equal(g.possessionSide,'home');
    assert.equal(finalLeadFraction(g,g,lead,true),.20);
  }
  const d={...game('darts_match'),darts:{firstId:'a',secondId:'b',firstLegs:5,secondLegs:3,nextThrow:'a'}};
  assert.equal(finalLeadFraction(d,d,lead,true),.20);
  assert.equal(leaderHasControl({...d,darts:{...d.darts,nextThrow:'b'}}),false);
});
test('CFB and soccer follow the same verification-based allocation',()=>{
  const cfb={...game('football_game'),sport:'CFB'};
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},true),.20);
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},false),.10);
  const soccer={...game('soccer_match'),home:2,away:0,homeUnits:2,awayUnits:0,matchRemainingSeconds:19};
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},true),.20);
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},false),.10);
  assert.equal(finalLeadFraction(cfb,cfb,{strategy:'over',fraction:.30},true),.30);
  const tied={...game('basketball_game'),home:10,away:10,homeUnits:10,awayUnits:10};
  assert.equal(finalLeadFraction(tied,tied,{...lead,fraction:.05},true),.20,'draw has no leader');
});
test('both live entry paths use the final verified allocation and funding rechecks recalculate it',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(source,/fraction:finalLeadFraction\(first,second,signal,independent===true,quote\)/);
  assert.match(source,/finalLeadFraction\(c.state,freshState,verifiedSignal,!kalshiOnly,quote\)/);
  assert.match(source,/fraction:finalLeadFraction\(state,checked,still,!kalshiOnly,executable\)/);
});
