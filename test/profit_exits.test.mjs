import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleProfitExit } from '../src/profit_exits.mjs';
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
