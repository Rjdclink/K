import test from 'node:test';
import assert from 'node:assert/strict';
import {completedTrade} from '../src/history.mjs';

const entry={order_id:'buy-1',market_ticker:'KXGAME-TEAM',fill_count:'10.00',created_at:'2026-10-28T13:00:00Z'};
const buy={order_id:'buy-1',ticker:entry.market_ticker,outcome_side:'yes',action:'buy',count_fp:'10.00',yes_price_dollars:'0.80',fee_cost:'0.10',created_time:'2026-10-28T13:00:01Z'};
const sale={order_id:'sell-1',ticker:entry.market_ticker,outcome_side:'yes',action:'sell',count_fp:'10.00',yes_price_dollars:'0.55',fee_cost:'0.05',created_time:'2026-10-28T13:04:00Z'};

test('history records actual sale loss once the whole position closes',()=>{
  assert.deepEqual(completedTrade(entry,[buy,sale],null),{occurredAt:new Date(sale.created_time).toISOString(),profitCents:-265,outcome:'closed'});
  assert.equal(completedTrade(entry,[buy,{...sale,count_fp:'4.00'}],null),null);
});
test('history includes wins, losses, and partial exit plus settlement',()=>{
  const yes={ticker:entry.market_ticker,market_result:'yes',settled_time:'2026-10-28T14:00:00Z'};
  const no={...yes,market_result:'no'};
  assert.equal(completedTrade(entry,[buy],yes).profitCents,190);
  assert.equal(completedTrade(entry,[buy],no).profitCents,-810);
  const partial={...sale,count_fp:'4.00'};
  assert.equal(completedTrade(entry,[buy,partial],yes).profitCents,5);
});
test('a winning market does not pay out shares already sold during a comeback',()=>{
  const kym={...entry,fill_count:'38.76'};
  const bought={...buy,count_fp:'38.76',yes_price_dollars:'0.97',fee_cost:'0.0828'};
  const sold={...sale,count_fp:'38.76',yes_price_dollars:'0.32',fee_cost:'0.2132'};
  const result=completedTrade(kym,[bought,sold],{market_result:'yes',settled_time:'2026-10-28T14:00:00Z'});
  assert.equal(result.profitCents,Math.round((38.76*.32-.2132-38.76*.97-.0828)*100));
  assert.equal(result.outcome,'settled');
});
test('history refuses incomplete and mixed fills instead of displaying an inaccurate result',()=>{
  assert.equal(completedTrade(entry,[buy,{...buy,order_id:'manual-buy'}],null),null);
  assert.equal(completedTrade(entry,[{...buy,count_fp:'9.00'},sale],null),null);
  assert.equal(completedTrade(entry,[buy,{...sale,fee_cost:null}],null),null);
  assert.equal(completedTrade(entry,[buy],null),null);
});
test('history includes an independently verified second buy, its fees, and all held shares',()=>{
  const upgraded={...entry,upgrade_order_id:'buy-upgrade',upgrade_fill_count:'5.00'};
  const second={...buy,order_id:'buy-upgrade',count_fp:'5.00',yes_price_dollars:'0.90',fee_cost:'0.15',created_time:'2026-10-28T13:05:00Z'};
  const yes={ticker:entry.market_ticker,market_result:'yes',settled_time:'2026-10-28T14:00:00Z'};
  assert.equal(completedTrade(upgraded,[buy,second],yes).profitCents,225);
  assert.equal(completedTrade(upgraded,[buy,second,{...sale,count_fp:'15.00',created_time:'2026-10-28T13:08:00Z'}],null).profitCents,-455);
  assert.equal(completedTrade(upgraded,[buy],yes),null,'missing upgrade fills must not produce a misleading profit');
  assert.equal(completedTrade(upgraded,[buy,{...second,order_id:'unknown'}],yes),null);
});

