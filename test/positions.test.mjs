import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedSaleProfitCents,halfPotentialProfitExitEligible,oneAndHalfExitEligible,profitTargetAllowed,overCorrectionAffects,correctionExitTargets} from '../src/positions.mjs';

test('1.5 times exit compares net proceeds with the full proportional cost',()=>{
  const held={position_fp:'20',market_exposure_dollars:'10.00',fees_paid_dollars:'0.20'};
  assert.equal(oneAndHalfExitEligible(held,{count:10,price:.80}),true);
  assert.equal(oneAndHalfExitEligible(held,{count:10,price:.75}),false);
  assert.equal(oneAndHalfExitEligible({...held,market_exposure_dollars:'14.00'},{count:10,price:.99}),false);
  assert.equal(oneAndHalfExitEligible({...held,fees_paid_dollars:null},{count:10,price:.80}),false);
  assert.equal(oneAndHalfExitEligible(held,{count:21,price:.99}),false);
});

test('soccer commanding leads skip the half-profit exit, including mixed combos',()=>{
  assert.equal(profitTargetAllowed({strategy:'lead',sport:'Soccer',market_ticker:'SOCCER-GAME'}),false);
  assert.equal(profitTargetAllowed({strategy:'lead',sport:'NBA',market_ticker:'COMBO',combo_legs:[{sport:'NBA'},{sport:'Soccer'}]}),false);
  assert.equal(profitTargetAllowed({strategy:'lead',sport:'NBA',market_ticker:'NBA-GAME'}),true);
  assert.equal(profitTargetAllowed({strategy:'over',sport:'Soccer',market_ticker:'SOCCER-TOTAL'}),true);
});

test('a corrected stat exits an over and its combo only when its own line uncrosses',()=>{
  const original={strategy:'over',market_ticker:'KXEPLTOTAL-26OCT31CFCMUN-3',reason:'3 scored; line 2.5 already passed'};
  const state={type:'soccer_match',verifiedLive:true,scoreKnown:true,scoreConsistent:true,home:2,away:0};
  const market={ticker:original.market_ticker,event_ticker:'KXEPLTOTAL-26OCT31CFCMUN',floor_strike:2.5};
  assert.equal(overCorrectionAffects(original,state,market),true);
  assert.equal(overCorrectionAffects({...original,reason:'4 scored; line 2.5 already passed'}, {...state,home:3},market),false,'still above the line');
  assert.equal(overCorrectionAffects({...original,strategy:'lead'},state,market),false,'a winner still ahead is not a corrected total');
  assert.equal(overCorrectionAffects(original,{...state,verifiedLive:false},market),false);
  assert.equal(overCorrectionAffects(original,{...state,scoreConsistent:false},market),false);
  const combo={market_ticker:'COMBO',strategy:'lead',combo_legs:[{market_ticker:original.market_ticker},{market_ticker:'OTHER'}]};
  const unrelated={market_ticker:'OTHER',strategy:'over',reason:'3 scored; line 2.5 already passed',game_id:'other'};
  assert.deepEqual([...correctionExitTargets([{...original,game_id:'chelsea'},combo,unrelated],
    new Map([['chelsea',state],['other',{...state,home:3}]]),new Map([[original.market_ticker,market]]))],[original.market_ticker,'COMBO']);
  const player={strategy:'over',market_ticker:'KXNBAPTS-26OCT31-JOHN',reason:'20 PTS by John Doe; line 19.5 already passed'};
  const playerMarket={ticker:player.market_ticker,event_ticker:'KXNBAPTS-26OCT31',floor_strike:19.5,
    custom_strike:{basketball_player:'john'},yes_sub_title:'John Doe: 20+'};
  const basketball={...state,type:'basketball_game',playerStats:{john:{points:19}}};
  assert.equal(overCorrectionAffects(player,basketball,playerMarket),true,'a player prop uses the named statistic');
  assert.equal(overCorrectionAffects(player,{...basketball,playerStats:{john:{points:21}}},playerMarket),false);
  const cricket={strategy:'over',market_ticker:'KXODITEAMTOTAL-26OCT31-KEN',reason:'Kenya has 231 runs; team total 230.5 crossed'};
  const cricketMarket={ticker:cricket.market_ticker,event_ticker:'KXODITEAMTOTAL-26OCT31',floor_strike:230.5,custom_strike:{cricket_team:'ken'}};
  assert.equal(overCorrectionAffects(cricket,{...state,type:'cricket_match',home:230,away:114,homeTeamId:'ken',awayTeamId:'png'},cricketMarket),true);
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

