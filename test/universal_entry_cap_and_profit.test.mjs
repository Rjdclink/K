import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumProfitCents,netSettlementProfitCents,orderSize} from '../src/strategy.mjs';
import {automaticEntryFraction} from '../src/automatic_entry_policy.mjs';
import {comboAllocation,comboLegAllocation,comboMinimumCents} from '../src/combos.mjs';

test('all ordinary entries require 50 cents net, commanding leads require only positive post-fee profit',()=>{
 for(const bankroll of [2500,10000,30000,1000000])for(const filledOrders of [0,10,20,35]){
  for(const strategy of ['no','over','weather','combo'])
   assert.equal(minimumProfitCents(strategy,bankroll,'',NaN,filledOrders),50,strategy);
  assert.equal(minimumProfitCents('lead',bankroll,'',NaN,filledOrders),1);
 }
 assert.equal(netSettlementProfitCents(10,0.80,2)>0,true);
});
test('all ordinary and lead entries, including winner combinations, cap at 100 percent',()=>{
 for(const strategy of ['no','lead','over','weather','combo']){
  assert.equal(automaticEntryFraction({strategy,fraction:.60}),1);
  assert.equal(automaticEntryFraction({strategy,fraction:.20}),1);
 }
 assert.equal(orderSize(100000,.40,1000,.25,1,100000,Infinity,2),orderSize(100000,.40,1000,.15,1,100000,Infinity,2));
 assert.equal(comboAllocation(),1);
 assert.equal(comboLegAllocation([{signal:{strategy:'lead',externallyVerified:true}}],.35),1);
 assert.equal(comboMinimumCents(.15,10000),0);
});
test('verified cushioned OVER retains its proof gate and shares the fee-inclusive 100% cap',()=>{
 const signal={strategy:'over',fraction:.45};
 const proof={verificationId:'a',contractKey:'k',route:'cushion'};
 assert.equal(automaticEntryFraction({...signal,game:{overVerification:proof,independentEntry:{verificationId:'a'},verificationId:'a'}}),1);
});