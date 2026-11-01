import test from 'node:test';
import assert from 'node:assert/strict';
import {completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates} from '../src/history.mjs';

test('final games missing from the broad settlement feed get prompt direct lookups for wins and losses',()=>{
  const now=Date.parse('2026-10-31T18:00:00Z');
  const pending=[
    {market_ticker:'WIN',game_status:'final',created_at:'2026-10-31T17:30:00Z'},
    {market_ticker:'LOSS',game_status:'final',created_at:'2026-10-31T17:20:00Z'},
    {market_ticker:'LIVE',game_status:'live',created_at:'2026-10-31T17:10:00Z'},
    {market_ticker:'NEW',game_status:'final',created_at:'2026-10-31T17:59:00Z'}
  ];
  assert.deepEqual(settlementLookupCandidates(pending,new Map(),now,0,5).map(row=>row.market_ticker),['WIN','LOSS']);
});

const entry={order_id:'buy-1',market_ticker:'KXGAME-TEAM',fill_count:'10.00',created_at:'2026-10-28T13:00:00Z'};
const buy={order_id:'buy-1',ticker:entry.market_ticker,outcome_side:'yes',action:'buy',count_fp:'10.00',yes_price_dollars:'0.80',fee_cost:'0.10',created_time:'2026-10-28T13:00:01Z'};
const sale={order_id:'sell-1',ticker:entry.market_ticker,outcome_side:'yes',action:'sell',count_fp:'10.00',yes_price_dollars:'0.55',fee_cost:'0.05',created_time:'2026-10-28T13:04:00Z'};

test('history records actual sale loss once the whole position closes',()=>{
  assert.deepEqual(completedTrade(entry,[buy,sale],null),{occurredAt:new Date(sale.created_time).toISOString(),profitCents:-265,outcome:'closed'});
  assert.equal(completedTrade(entry,[buy,{...sale,count_fp:'4.00'}],null),null);
});
test('a completed manual sale can reconcile history when the sale fill is absent',()=>{
  const manual=manualSaleFill({ticker:entry.market_ticker,created_at:sale.created_time,
    result:{order_id:'manual-sell',fill_count:'10.00',average_fill_price:'0.9700',average_fee_paid:'0.0020'}});
  assert.equal(manual.fee_cost,'0.02');
  assert.equal(completedTrade(entry,[buy,manual],null).profitCents,158);
  assert.equal(manualSaleFill({ticker:entry.market_ticker,created_at:sale.created_time,result:{fill_count:'10.00'}}),null);
});
test('a Kalshi manual YES sale reported with NO outcome side still reconciles by its exact order ID',()=>{
  const manual=manualSaleFill({ticker:entry.market_ticker,created_at:sale.created_time,
    result:{order_id:'manual-sell',fill_count:'10.00',average_fill_price:'0.9700',average_fee_paid:'0.0020'}});
  const reported={...manual,outcome_side:'no',side:'no',fee_cost:'0.02'};
  const normalized=reconcileManualSaleFills([buy,reported,{...reported,order_id:'other-sell'}],[manual]);
  assert.equal(normalized[1].outcome_side,'yes');
  assert.equal(normalized[2].outcome_side,'no');
  assert.equal(completedTrade(entry,normalized,null).profitCents,158);
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
test('history includes a later robust-over top-up alongside an earlier verification upgrade',()=>{
  const upgraded={...entry,upgrade_order_id:'verification-buy',upgrade_fill_count:'5.00',robust_upgrade_order_id:'robust-buy',robust_upgrade_fill_count:'2.00'};
  const second={...buy,order_id:'verification-buy',count_fp:'5.00',created_time:'2026-10-28T13:05:00Z'};
  const third={...buy,order_id:'robust-buy',count_fp:'2.00',created_time:'2026-10-28T13:06:00Z'};
  const yes={ticker:entry.market_ticker,market_result:'yes',settled_time:'2026-10-28T14:00:00Z'};
  assert.equal(completedTrade(upgraded,[buy,second,third],yes)?.profitCents,310);
  assert.equal(completedTrade(upgraded,[buy,second],yes),null);
});
test('history includes a later verified combo add-on only after its actual fill',()=>{
  const combo={...entry,combo_upgrade_order_id:'combo-add-on',combo_upgrade_fill_count:'5.00'};
  const second={...buy,order_id:'combo-add-on',count_fp:'5.00',yes_price_dollars:'0.90',fee_cost:'0.15',created_time:'2026-10-28T13:05:00Z'};
  const yes={ticker:entry.market_ticker,market_result:'yes',settled_time:'2026-10-28T14:00:00Z'};
  assert.equal(completedTrade(combo,[buy,second],yes).profitCents,225);
  assert.equal(completedTrade(combo,[buy],yes),null);
  assert.equal(completedTrade(combo,[buy,{...second,order_id:'other'}],yes),null);
});
test('history counts a manual combo add-on and its actual fee',()=>{
  const combo={...entry,manual_combo_buys:[{order_id:'manual-add-on',fill_count:5}]};
  const extra={...buy,order_id:'manual-add-on',count_fp:'5',yes_price_dollars:'.90',fee_cost:'.15',created_time:'2026-10-28T13:05:00Z'};
  const settled={ticker:entry.market_ticker,market_result:'yes',settled_time:'2026-10-28T14:00:00Z'};
  assert.equal(completedTrade(combo,[buy,extra],settled)?.profitCents,225);
  assert.equal(completedTrade(combo,[buy],settled),null);
  assert.equal(completedTrade(combo,[buy,{...extra,order_id:'untracked'}],settled),null);
});


test('recorded automatic exits normalize canonical NO buys into YES sales and recover losses',()=>{
  const reported={...sale,outcome_side:'no',side:'no',action:'buy',book_side:'bid'};
  const normalized=reconcileManualSaleFills([buy,reported],[],['sell-1']);
  assert.equal(completedTrade(entry,normalized,null)?.profitCents,-265);
  assert.equal(completedTrade(entry,[buy,reported],null),null);
  const other=reconcileManualSaleFills([{...reported,order_id:'unrelated'}],[],['sell-1']);
  assert.equal(other[0].action,'buy','unrelated NO buys must not become YES exits');
});
test('modern executed sale uses actual fixed-point costs and fees rather than the limit price',()=>{
  const actual=manualSaleFill({ticker:entry.market_ticker,created_at:sale.created_time,result:{order_id:'modern',
    fill_count_fp:'10.00',side:'yes',action:'sell',outcome_side:'no',yes_price_dollars:'.50',
    maker_fill_cost_dollars:'0.000000',taker_fill_cost_dollars:'4.500000',maker_fees_dollars:'0.000000',taker_fees_dollars:'.05'}});
  assert.equal(Number(actual.yes_price_dollars),.55);
  assert.equal(Number(actual.fee_cost),.05);
  assert.equal(completedTrade(entry,[buy,actual],null)?.profitCents,-265);
  assert.equal(manualSaleFill({ticker:entry.market_ticker,created_at:sale.created_time,result:{order_id:'unknown',fill_count_fp:'10',yes_price_dollars:'.99'}}),null,'a limit price alone cannot establish proceeds');
});
