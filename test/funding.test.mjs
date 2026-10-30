import test from 'node:test';
import assert from 'node:assert/strict';
import { marketShard, shardCash, transferPlan, shouldFundCombo } from '../src/funding.mjs';

test('plans a bounded internal funding transfer for the actual market shard',()=>{
  const account={balance:5097,balance_breakdown:[{exchange_index:0,balance:'50.9786'},{exchange_index:3,balance:'0.0000'}]};
  assert.equal(marketShard({exchange_index:0},{exchange_index:3}),3);
  assert.equal(shardCash(account,0),5097);
  assert.equal(shardCash(account,3),0);
  assert.deepEqual(transferPlan(account,3,1530),{sourceShard:0,destinationShard:3,amountCenticents:153000});
  assert.deepEqual(transferPlan(account,3,6000),{sourceShard:0,destinationShard:3,amountCenticents:509700});
  assert.equal(transferPlan(account,0,2000),null);
  assert.equal(transferPlan({balance:5097},3,1500),null);
});

test('a few cents below the combo cap uses existing shard cash',()=>{
  assert.equal(shouldFundCombo(1464,1468),false);
  assert.equal(shouldFundCombo(500,1468),true);
  assert.equal(shouldFundCombo(0,1468),true);
});

