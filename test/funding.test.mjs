import test from 'node:test';
import assert from 'node:assert/strict';
import { marketShard, shardCash, transferPlan, comboShardBudget, awaitShardCash } from '../src/funding.mjs';

test('plans a bounded internal funding transfer for the actual market shard',()=>{
  const account={balance:5097,balance_breakdown:[{exchange_index:0,balance:'50.9786'},{exchange_index:3,balance:'0.0000'}]};
  assert.equal(marketShard({exchange_index:0},{exchange_index:3}),3);
  assert.equal(shardCash(account,0),5097);
  assert.equal(shardCash(account,3),0);
  assert.deepEqual(transferPlan(account,3,1530),{sourceShard:0,destinationShard:3,amountCenticents:153000});
  assert.deepEqual(transferPlan(account,3,6000),{sourceShard:0,destinationShard:3,amountCenticents:509700});
  assert.equal(transferPlan(account,0,2000),null);
  assert.equal(transferPlan({balance:5097},3,1500),null);
  assert.deepEqual(transferPlan(account,3,1500,2000),{sourceShard:0,destinationShard:3,amountCenticents:150000});
  assert.equal(transferPlan(account,3,4000,5100),null);
});

test('combo allocation is a ceiling even when its shard has less cash',()=>{
  assert.equal(comboShardBudget(500,1468),500);
  assert.equal(comboShardBudget(1464,1468),1464);
  assert.equal(comboShardBudget(2000,1468),1468);
});

test('a transfer acknowledgement waits for completion and real destination cash',async()=>{
  let polls=0,reads=0;
  const result=await awaitShardCash({destination:2,desiredCents:1500,transferId:'transfer-1',
    lookup:async()=>({status:++polls<2?'pending':'complete'}),
    readBalance:async()=>({balance_breakdown:[{exchange_index:2,balance:++reads<2?'12.00':'15.00'}]}),
    sleep:async()=>{},timeoutMs:2000});
  assert.equal(shardCash(result,2),1500);
  assert.equal(polls,3);
  assert.equal(reads,2);
  const pending=await awaitShardCash({destination:2,desiredCents:1500,transferId:'transfer-2',
    lookup:async()=>({status:'pending'}),readBalance:async()=>{throw Error('Must not trust pending funds')},
    timeoutMs:0});
  assert.equal(pending,null);
});

test('a candidate can draw a second shard when the first covers only part of the allocation',()=>{
  const account={balance_breakdown:[{exchange_index:0,balance:'2.00'},{exchange_index:1,balance:'6.00'},{exchange_index:2,balance:'4.00'}]};
  const first=transferPlan(account,0,1100);
  assert.deepEqual(first,{sourceShard:1,destinationShard:0,amountCenticents:60000});
  const after={balance_breakdown:[{exchange_index:0,balance:'8.00'},{exchange_index:1,balance:'0.00'},{exchange_index:2,balance:'4.00'}]};
  assert.deepEqual(transferPlan(after,0,1100),{sourceShard:2,destinationShard:0,amountCenticents:30000});
});


