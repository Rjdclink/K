import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingVerifiedOverCents,upgradeEligible} from '../src/upgrades.mjs';
import {orderSize,estimatedCostCents} from '../src/strategy.mjs';

test('verified over top-up deducts held exposure and fees from the total 30% cap',()=>{
  const position={ticker:'OVER',position_fp:'10.00',market_exposure_dollars:'99.00',fees_paid_dollars:'1.00'};
  assert.equal(remainingVerifiedOverCents(position,100000),20000);
  const count=orderSize(30000,'.94','1000',.30,1,100000,remainingVerifiedOverCents(position,100000),2);
  assert.ok(count>0);
  assert.ok(estimatedCostCents(count,.94,2)+10000<=30000);
  assert.equal(remainingVerifiedOverCents({...position,market_exposure_dollars:'299.00'},100000),0);
  assert.equal(remainingVerifiedOverCents({...position,fees_paid_dollars:null},100000),0);
  assert.equal(remainingVerifiedOverCents({...position,position_fp:'0.00'},100000),0);
});

test('only the same held Kalshi-only over with a 30% verified rule is upgradeable',()=>{
  const fill={status:'filled',strategy:'over',reason:'score; Kalshi-only two reads',market_ticker:'OVER',event_ticker:'GAME',game_id:'m1'};
  const position={ticker:'OVER',position_fp:'10.00'};
  const candidate={market:{ticker:'OVER'},event:{event_ticker:'GAME'},milestone:{id:'m1'},signal:{strategy:'over',fraction:.30}};
  assert.equal(upgradeEligible(fill,position,candidate),true);
  for(const altered of [{...fill,strategy:'lead'},{...fill,reason:'verified'},{...fill,game_id:'m2'},{...fill,combo_legs:[1]}])
    assert.equal(upgradeEligible(altered,position,candidate),false);
  assert.equal(upgradeEligible(fill,position,{...candidate,signal:{strategy:'over',fraction:.05}}),false);
  assert.equal(upgradeEligible(fill,{...position,position_fp:'0.00'},candidate),false);
});
