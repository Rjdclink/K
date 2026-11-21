import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSettlementProfit,closedOffsetProfit,combineAccountSettlements} from '../src/settlement_accounting.mjs';
import {normalizeAccountFill,realizedAccountMarket,summarizeAccountMarkets} from '../src/account_history.mjs';
import {completedNoTrade} from '../src/history.mjs';
import {ACCOUNT_HISTORY_UNION_SQL} from '../src/account_history_query.mjs';

const settled='2026-11-21T15:24:54.100918Z';
const union={ticker:'KXBUNDESLIGA1HTOTAL-26NOV21UNIRBL-3',
 market_result:'no',settled_time:settled,
 revenue:0,no_count_fp:'84.04',yes_count_fp:'84.04',
 no_total_cost_dollars:'69.753200',yes_total_cost_dollars:'2.521200',fee_cost:'1.001300'};
const solihull={...union,ticker:'KXENGNLTOTAL-26NOV21SOLALT-5',
 no_count_fp:'73.71',yes_count_fp:'73.71',no_total_cost_dollars:'70.024500',
 yes_total_cost_dollars:'1.474200',fee_cost:'0.346300'};
const ostersund='KXSUPERETTANTOTAL-26NOV21OSTVBG-3';
const f=(id,side,qty,price,fee,action='sell',ticker=union.ticker,time='2026-11-21T15:11:57Z')=>({
 ticker,fill_id:id,order_id:'order-'+id,side,action,count_fp:String(qty),fee_cost:String(fee),
 no_price_dollars:String(side==='no'?price:1-price),
 yes_price_dollars:String(side==='yes'?price:1-price),created_time:time});
const unionFills=[
 normalizeAccountFill(f('union-no','no',84.04,.83,.8301)),
 normalizeAccountFill(f('union-yes','yes',84.04,.03,.1712,'sell',union.ticker,'2026-11-21T15:18:22Z'))
];
const ostRaw=[
 f('ost-first','no',70.57,.97,.1438,'sell',ostersund,'2026-11-21T13:39:46Z'),
 f('ost-topup1','no',30,.99,.0208,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup2','no',57.98,.99,.0402,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup3','no',239.43,.88,1.7699,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup4','no',.10,.90,.0007,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup5','no',.10,.88,.0008,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup6','no',.10,.91,.0005,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-topup7','no',.10,.89,.0006,'buy',ostersund,'2026-11-21T13:47:18Z'),
 f('ost-offset','yes',398.38,.01,.2761,'sell',ostersund,'2026-11-21T13:50:31Z')
];
const ostFills=ostRaw.map(normalizeAccountFill);

test('calibrated settlement returns +$10.76 for Union Berlin, not the false -$70.58 bot history',()=>{
 assert.equal(verifiedSettlementProfit(union)?.profitCents,1076);
 assert.equal(verifiedSettlementProfit(solihull)?.profitCents,187);
 assert.equal(realizedAccountMarket(unionFills,union)?.profitCents,1076);
});
test('fully offset NO market is a +$25.53 realized CLOSED trade without waiting for settlement',()=>{
 assert.equal(closedOffsetProfit(ostFills)?.profitCents,2553);
 assert.equal(closedOffsetProfit(ostFills)?.outcome,'closed');
 assert.equal(realizedAccountMarket(ostFills,null)?.profitCents,2553);
 const result=summarizeAccountMarkets(ostRaw,[]);
 assert.equal(result.rows.find(x=>x.ticker===ostersund)?.profitCents,2553);
});
test('negative YES + positive NO round trip remains unsettled if sides do not fully reconcile',()=>{
 assert.equal(closedOffsetProfit(ostFills.slice(0,-1)),null);
 assert.equal(closedOffsetProfit([...ostFills,{...ostFills.at(-1),count:100}]),null);
 assert.equal(realizedAccountMarket(ostFills.slice(0,-1),null),null);
 assert.equal(verifiedSettlementProfit({...union,no_count_fp:'invalid'}),null);
 assert.equal(verifiedSettlementProfit({...union,fee_cost:null}),null);
 assert.equal(verifiedSettlementProfit({...union,market_result:'unsettled'}),null);
});
test('settlement formula handles YES wins, NO wins and legitimate loses without inventing collateral',()=>{
 assert.equal(verifiedSettlementProfit({...union,no_count_fp:'0',yes_count_fp:'10',
   no_total_cost_dollars:'0',yes_total_cost_dollars:'9.00',fee_cost:'0.10',revenue:1000,market_result:'yes'})?.profitCents,90);
 assert.equal(verifiedSettlementProfit({...union,no_count_fp:'10',yes_count_fp:'0',
   no_total_cost_dollars:'3.00',yes_total_cost_dollars:'0',fee_cost:'0.10',revenue:1000,market_result:'no'})?.profitCents,690);
 assert.equal(verifiedSettlementProfit({...union,no_count_fp:'10',yes_count_fp:'0',
   no_total_cost_dollars:'3.00',yes_total_cost_dollars:'0',fee_cost:'0.10',revenue:0,market_result:'yes'})?.profitCents,-310);
});
test('bot-only NO settlement reconciliation uses exact exchange economics, never zero-revenue as a total loss',()=>{
 const entry={strategy:'no',order_id:'order-union-no',market_ticker:union.ticker,
   fill_count:84.04,created_at:'2026-11-21T15:11:56Z'};
 const fills=unionFills.map(v=>({ticker:v.ticker,order_id:v.orderId,
   outcome_side:v.side,side:v.side,action:v.action,count_fp:String(v.count),
   no_price_dollars:String(v.side==='no'?v.price:1-v.price),
   yes_price_dollars:String(v.side==='yes'?v.price:1-v.price),
   fee_cost:String(v.fee),created_time:v.createdAt}));
 assert.equal(completedNoTrade(entry,fills,union)?.profitCents,1076);
 assert.equal(completedNoTrade(entry,fills,{...union,no_total_cost_dollars:undefined}),null,
  'mixed-side trade must never fall back to the incorrect revenue-only loss');
});
test('multiple settled subaccounts combine every cost, count and fee, never just payout revenue',()=>{
 const a={...union,ticker:'KXMULTI-A',no_count_fp:'50',yes_count_fp:'50',
   no_total_cost_dollars:'40.000000',yes_total_cost_dollars:'2.000000',fee_cost:'0.500000'};
 const b={...a,no_count_fp:'34.04',yes_count_fp:'34.04',
   no_total_cost_dollars:'29.753200',yes_total_cost_dollars:'0.521200',fee_cost:'0.501300'};
 const joined=combineAccountSettlements([a,b]);
 assert.equal(joined.get(a.ticker).no_count_fp,84.04);
 assert.equal(joined.get(a.ticker).yes_count_fp,84.04);
 assert.equal(joined.get(a.ticker).fee_cost,1.0013);
 assert.equal(verifiedSettlementProfit(joined.get(a.ticker))?.profitCents,1076);
 assert.equal(verifiedSettlementProfit(combineAccountSettlements([a,{...b,market_result:'yes'}]).get(a.ticker)),null);
 assert.equal(verifiedSettlementProfit(combineAccountSettlements([a,{...b,fee_cost:undefined}]).get(a.ticker)),null);
});
test('the History query prioritizes exchange settlement and complete offsetting fills over bot-only PnL',()=>{
 assert.match(ACCOUNT_HISTORY_UNION_SQL,/account_history_settlements/);
 assert.match(ACCOUNT_HISTORY_UNION_SQL,/account_history_fills/);
 assert.match(ACCOUNT_HISTORY_UNION_SQL,/account_history_sync/);
 assert.match(ACCOUNT_HISTORY_UNION_SQL,/LEAST\(/);
 assert.match(ACCOUNT_HISTORY_UNION_SQL,/first_fill_at|filled_at/);
});
