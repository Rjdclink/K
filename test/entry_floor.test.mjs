import test from 'node:test';
import assert from 'node:assert/strict';
import { filledOrderGateCount } from '../src/entry_floor.mjs';
import { minimumProfitCents, netSettlementProfitCents } from '../src/strategy.mjs';

test('final gate matches the filled card and reserves parallel submissions',()=>{
  const positions={market_positions:Array.from({length:10},(_,i)=>({ticker:`M${i}`,position_fp:'1.00'}))};
  const filled=Array.from({length:10},(_,i)=>({market_ticker:`M${i}`,status:'filled'}));
  assert.equal(filledOrderGateCount(positions,filled,'NEW'),10);
  assert.equal(minimumProfitCents('over',5000,'',NaN,filledOrderGateCount(positions,filled,'NEW')),15);
  assert.equal(filledOrderGateCount(positions,filled.slice(0,9),'NEW'),9);
  assert.equal(filledOrderGateCount(positions,filled.slice(0,9).concat({market_ticker:'M9',status:'unfilled'}),'NEW'),9);
  assert.equal(filledOrderGateCount(positions,filled.slice(0,9).concat({market_ticker:'PENDING',status:'combo_pending'}),'NEW'),10);
  assert.equal(filledOrderGateCount(positions,filled.concat({market_ticker:'NEW',status:'reserved'}),'NEW'),10);
  assert.equal(filledOrderGateCount(positions,filled.concat({market_ticker:'OTHER',status:'reserved'},{market_ticker:'OTHER',status:'retrying'}),'NEW'),11);
  assert.equal(filledOrderGateCount({market_positions:positions.market_positions.slice(1)},filled,'NEW'),9);
  assert.equal(netSettlementProfitCents(1,.75,2)>=minimumProfitCents('over',5000,'',NaN,10),true);
  assert.equal(netSettlementProfitCents(1,.75,2)<minimumProfitCents('over',5000,'',NaN,15),true);
  assert.equal(netSettlementProfitCents(2,.75,2)>=minimumProfitCents('over',5000,'',NaN,15),true);
});
