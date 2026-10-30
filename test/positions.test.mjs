import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedSaleProfitCents,positiveExitEligible} from '../src/positions.mjs';

test('sale P&L uses executable shares, proportional cost basis and both fees',()=>{
  const held={position_fp:'20.00',market_exposure_dollars:'15.00',fees_paid_dollars:'0.20'};
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.92},.75),149);
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.70},.75),-90);
  assert.equal(estimatedSaleProfitCents(held,{count:21,price:.92},.75),null);
});

test('positive sale exits single basketball and tennis positions only after fees',()=>{
  const trade=(sport,strategy='lead')=>({sport,strategy});
  assert.equal(positiveExitEligible(trade('Tennis'),'tennis_tournament_singles',1),true);
  assert.equal(positiveExitEligible(trade('NBA'),'basketball_game',1),true);
  assert.equal(positiveExitEligible(trade('Tennis'),'tennis_tournament_singles',0),false);
  assert.equal(positiveExitEligible(trade('Tennis'),'tennis_tournament_singles',-1),false);
  assert.equal(positiveExitEligible(trade('Tennis','over'),'tennis_tournament_singles',100),false);
  assert.equal(positiveExitEligible(trade('Table tennis'),'table_tennis_match',1),false);
  assert.equal(positiveExitEligible(trade('Soccer'),'soccer_game',1),false);
  assert.equal(positiveExitEligible({strategy:'lead',combo_legs:[{sport:'Soccer',strategy:'lead'},{sport:'Tennis',strategy:'lead'}]},'',1),false);
  assert.equal(positiveExitEligible({strategy:'lead',combo_legs:[{sport:'Soccer',strategy:'lead'},{sport:'Football',strategy:'lead'}]},'',1),false);
});

