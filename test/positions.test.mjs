import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedSaleProfitCents,halfPotentialProfitExitEligible,oneAndHalfExitEligible,soccerOverCorrectionAffects,soccerCorrectionTargets} from '../src/positions.mjs';

test('1.5 times exit compares net proceeds with the full proportional cost',()=>{
  const held={position_fp:'20',market_exposure_dollars:'10.00',fees_paid_dollars:'0.20'};
  assert.equal(oneAndHalfExitEligible(held,{count:10,price:.80}),true);
  assert.equal(oneAndHalfExitEligible(held,{count:10,price:.75}),false);
  assert.equal(oneAndHalfExitEligible({...held,market_exposure_dollars:'14.00'},{count:10,price:.99}),false);
  assert.equal(oneAndHalfExitEligible({...held,fees_paid_dollars:null},{count:10,price:.80}),false);
  assert.equal(oneAndHalfExitEligible(held,{count:21,price:.99}),false);
});

test('a removed soccer goal triggers exit only when it uncrosses the held over',()=>{
  const original={strategy:'over',market_ticker:'KXEPLTOTAL-26OCT31CFCMUN-3',reason:'3 scored; line 2.5 already passed'};
  const state={type:'soccer_match',verifiedLive:true,scoreKnown:true,scoreConsistent:true,home:2,away:0};
  assert.equal(soccerOverCorrectionAffects(original,state),true);
  assert.equal(soccerOverCorrectionAffects({...original,reason:'4 scored; line 2.5 already passed'}, {...state,home:3}),false,'still above the line');
  assert.equal(soccerOverCorrectionAffects({...original,strategy:'lead'},state),false,'a winner still ahead is not a corrected total');
  assert.equal(soccerOverCorrectionAffects(original,{...state,verifiedLive:false}),false);
  assert.equal(soccerOverCorrectionAffects(original,{...state,scoreConsistent:false}),false);
  const combo={market_ticker:'COMBO',strategy:'lead',combo_legs:[{market_ticker:original.market_ticker},{market_ticker:'OTHER'}]};
  const unrelated={market_ticker:'OTHER',strategy:'over',reason:'3 scored; line 2.5 already passed',game_id:'other'};
  assert.deepEqual([...soccerCorrectionTargets([{...original,game_id:'chelsea'},combo,unrelated],
    new Map([['chelsea',state],['other',{...state,home:3}]]))],[original.market_ticker,'COMBO']);
});

test('sale P&L uses executable shares, proportional cost basis and both fees',()=>{
  const held={position_fp:'20.00',market_exposure_dollars:'15.00',fees_paid_dollars:'0.20'};
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.92},.75),149);
  assert.equal(estimatedSaleProfitCents(held,{count:10,price:.70},.75),-90);
  assert.equal(estimatedSaleProfitCents(held,{count:21,price:.92},.75),null);
});

test('lead cash-out needs half the possible net settlement profit after both fees and full bid depth',()=>{
  const held={position_fp:'10.00',market_exposure_dollars:'7.00',fees_paid_dollars:'0.10'};
  // Maximum net payout profit is $2.90; the sale fee is reserved separately.
  assert.equal(halfPotentialProfitExitEligible(held,{count:10,price:.88}),true);
  assert.equal(halfPotentialProfitExitEligible(held,{count:10,price:.86}),false);
  assert.equal(halfPotentialProfitExitEligible(held,{count:9.99,price:.99}),false,'partial depth does not trigger a full exit');
  assert.equal(halfPotentialProfitExitEligible({...held,fees_paid_dollars:null},{count:10,price:.99}),false);
  assert.equal(halfPotentialProfitExitEligible({...held,market_exposure_dollars:null},{count:10,price:.99}),false);
  assert.equal(halfPotentialProfitExitEligible({...held,market_exposure_dollars:'10.00'},{count:10,price:.99}),false);
  assert.equal(halfPotentialProfitExitEligible(held,{count:10,price:1}),false,'an invalid bid cannot trigger an exit');
});

