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
test('history refuses incomplete and mixed fills instead of displaying an inaccurate result',()=>{
  assert.equal(completedTrade(entry,[buy,{...buy,order_id:'manual-buy'}],null),null);
  assert.equal(completedTrade(entry,[{...buy,count_fp:'9.00'},sale],null),null);
  assert.equal(completedTrade(entry,[buy,{...sale,fee_cost:null}],null),null);
  assert.equal(completedTrade(entry,[buy],null),null);
});
