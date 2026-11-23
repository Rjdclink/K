import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleProfitExit,firstProfitableLeadQuote } from '../src/profit_exits.mjs';
const position={position_fp:'10',market_exposure_dollars:'5.00',fees_paid_dollars:'0.10'};
test('lead position exits only when net sale proceeds exceed cost and both fees',()=>{
 assert.equal(eligibleProfitExit('lead',position,{price:.60,count:10}),true);
 assert.equal(eligibleProfitExit('lead',position,{price:.50,count:10}),false);
});
test('overs and mixed over combos never auto-exit',()=>{
 assert.equal(eligibleProfitExit('over',position,{price:.90,count:10}),false);
 assert.equal(eligibleProfitExit('lead',position,{price:.90,count:10},[{strategy:'over'}]),false);
});
test('unknown purchase cost or fees fail closed',()=>{
 assert.equal(eligibleProfitExit('lead',{position_fp:'10'}, {price:.90,count:10}),false);
});


test('protective lead exits choose the first executable profitable size across bid depths',()=>{
 const p={position_fp:'10',market_exposure_dollars:'9.00',fees_paid_dollars:'0.05'};
 const book={yes_dollars:[[.98,.01],[.97,4],[.96,6],[.89,20]]};
 const sale=firstProfitableLeadQuote(p,book,{feeReserveMultiplier:2});
 assert.deepEqual(sale,{price:.96,count:10},
  'maximal executable quantity still selling at a conservative profitable limit');
 assert.ok(eligibleProfitExit('lead',p,sale,[],2));
});
test('protective sale never uses a losing deeper level, a partial quote without positive profit, or unknown basis',()=>{
 const p={position_fp:'10',market_exposure_dollars:'9.00',fees_paid_dollars:'.05'};
 const b={yes_dollars:[[.98,.01],[.95,2],[.89,8]]};
 const sale=firstProfitableLeadQuote(p,b,{feeReserveMultiplier:2});
 assert.ok(sale?.count<=2.01);
 assert.ok(eligibleProfitExit('lead',p,sale,[],2));
 assert.equal(firstProfitableLeadQuote({...p,fees_paid_dollars:undefined},b),null);
 assert.equal(firstProfitableLeadQuote(p,{yes_dollars:[[.88,10]]}),null);
 assert.equal(firstProfitableLeadQuote(p,b,{feeReserveMultiplier:100}),null);
});
