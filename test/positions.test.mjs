import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedSaleProfitCents} from '../src/positions.mjs';

test('sale P&L uses executable shares, proportional cost basis and both fees',()=>{
  const held={position_fp:'20.00',market_exposure_dollars:'15.00',fees_paid_dollars:'0.20'};
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.92},.75),149);
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.70},.75),-90);
  assert.equal(estimatedSaleProfitCents(held,{count:21,price:.92},.75),null);
});
