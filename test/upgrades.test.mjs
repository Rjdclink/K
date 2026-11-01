import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingVerifiedOverCents,upgradeEligible} from '../src/upgrades.mjs';
import {orderSize,estimatedCostCents} from '../src/strategy.mjs';

test('verified over top-up deducts held exposure and fees from the total 15% cap',()=>{
  const position={ticker:'OVER',position_fp:'10.00',market_exposure_dollars:'29.00',fees_paid_dollars:'1.00'};
  assert.equal(remainingVerifiedOverCents(position,100000),12000);
  const count=orderSize(30000,'.94','1000',.15,1,100000,remainingVerifiedOverCents(position,100000),2);
  assert.ok(count>0);
  assert.ok(estimatedCostCents(count,.94,2)+3000<=15000);
  assert.equal(remainingVerifiedOverCents({...position,market_exposure_dollars:'149.00'},100000),0);
  assert.equal(remainingVerifiedOverCents({...position,fees_paid_dollars:null},100000),0);
  assert.equal(remainingVerifiedOverCents({...position,position_fp:'0.00'},100000),0);
  assert.equal(remainingVerifiedOverCents(position,100000,.40),37000,'a robust verified over may reach 40% inclusive of its held cost');
  assert.equal(remainingVerifiedOverCents(position,100000,.20),17000,'a timed uncushioned over may reach 20% inclusive of its held cost');
  assert.equal(remainingVerifiedOverCents(position,100000,.25),22000,'verified variable-value props may reach 25% inclusive of held cost');
});

test('held overs can upgrade after timed proof to 20%, or to 40% with a scoring cushion',()=>{
  const fill={status:'filled',strategy:'over',reason:'score; Kalshi-only two reads',market_ticker:'OVER',event_ticker:'GAME',game_id:'m1'};
  const position={ticker:'OVER',position_fp:'10.00'};
  const candidate={market:{ticker:'OVER'},event:{event_ticker:'GAME'},milestone:{id:'m1'},signal:{strategy:'over',fraction:.15}};
  assert.equal(upgradeEligible(fill,position,candidate),true);
  assert.equal(upgradeEligible(fill,position,{...candidate,signal:{strategy:'over',fraction:.40}}),true);
  assert.equal(upgradeEligible(fill,position,{...candidate,signal:{strategy:'over',fraction:.20}}),true);
  assert.equal(upgradeEligible(fill,position,{...candidate,signal:{strategy:'over',fraction:.25}}),true);
  assert.equal(upgradeEligible({...fill,reason:'independently verified'},position,{...candidate,signal:{strategy:'over',fraction:.40}}),true,'an existing verified over can later be topped up only at the robust tier');
  assert.equal(upgradeEligible({...fill,reason:'independently verified'},position,candidate),true);
  for(const altered of [{...fill,strategy:'lead'},{...fill,game_id:'m2'},{...fill,combo_legs:[1]}])
    assert.equal(upgradeEligible(altered,position,candidate),false);
  assert.equal(upgradeEligible(fill,position,{...candidate,signal:{strategy:'over',fraction:.05}}),false);
  assert.equal(upgradeEligible(fill,{...position,position_fp:'0.00'},candidate),false);
});
