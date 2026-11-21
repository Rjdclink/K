import test from 'node:test';
import assert from 'node:assert/strict';
import {noNearLossScore,profitableNoReductionQuote} from '../src/no_protective_exit.mjs';
const g=(home,away,other={})=>({id:'g',type:'soccer_match',sport:'Soccer',period:2,
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,observedAt:Date.now(),home,away,...other});
const m=(line=1.5,series='KXEPLTOTAL',other={})=>({ticker:series+'-TEST',event_ticker:series+'-TEST',
 floor_strike:line,status:'active',rules_primary:'90 minutes including stoppage but not extra time',...other});
const pos=(count=10,cost=6,fees=.1)=>({position_fp:-count,market_exposure_dollars:String(cost),
 fees_paid_dollars:String(fees)});
const book=(bid,size=10)=>({no_dollars:[[String(bid),String(size)]]});
test('1.5 at 0–0 is safe, 1–0 is exactly one goal from losing',()=>{
 assert.equal(noNearLossScore(g(0,0),m()),null);
 assert.equal(noNearLossScore(g(1,0),m()),1);
 assert.equal(noNearLossScore(g(0,1),m()),1);
 assert.equal(noNearLossScore(g(1,1),m()),null);
});
test('2.5 at 1–1 arms; four-goal score does not create a new entry or unwanted sale',()=>{
 assert.equal(noNearLossScore(g(1,1),m(2.5)),2);
 assert.equal(noNearLossScore(g(0,1),m(2.5)),null);
 assert.equal(noNearLossScore(g(1,2),m(2.5)),null);
 assert.equal(noNearLossScore(g(1,1,{verifiedLive:false}),m(2.5)),null);
 assert.equal(noNearLossScore(g(1,1,{scoreConsistent:false}),m(2.5)),null);
 assert.equal(noNearLossScore(g(1,1,{observedAt:Date.now()-11000}),m(2.5)),null);
 assert.equal(noNearLossScore(g(1,1),m(2.5,'KXEPLTEAMTOTAL')),null);
});
test('selected third NHL period is not confused with whole-game goals',()=>{
 const h={...g(3,3),sport:'NHL',type:'hockey_match',period:3,
  periodScores:[{number:1,home:1,away:1},{number:2,home:1,away:1},{number:3,home:1,away:1}]};
 assert.equal(noNearLossScore(h,m(2.5,'KXNHL3PTOTAL')),2);
 assert.equal(noNearLossScore(h,m(6.5,'KXNHLTOTAL')),6);
 assert.equal(noNearLossScore({...h,periodScores:[]},m(2.5,'KXNHL3PTOTAL')),null);
});
test('closing negative NO buys YES from NO bids; never uses YES bids or opens long YES',()=>{
 const quote=profitableNoReductionQuote(pos(),book(.70),m());
 assert.equal(quote?.yesPrice,.30);
 assert.equal(quote?.count,10);
 assert.ok(quote?.netProfitCents>0);
 assert.equal(profitableNoReductionQuote(pos(),book(.60),m()),null);
 assert.equal(profitableNoReductionQuote(pos(),{yes_dollars:[['.99','20']]},m()),null);
 assert.equal(profitableNoReductionQuote({...pos(),position_fp:10},book(.90),m()),null);
 assert.equal(profitableNoReductionQuote({...pos(),fees_paid_dollars:null},book(.90),m()),null);
});
test('partial NO closing and high fee multipliers are checked after all fees',()=>{
 const partial=profitableNoReductionQuote(pos(),book(.95,3.21),m());
 assert.equal(partial?.count,3.21);
 assert.ok(partial.netProfitCents>0);
 assert.equal(profitableNoReductionQuote(pos(),book(.95,.75),m(2.5,'KXEPLTOTAL',{fractional_trading_enabled:false})),null);
 assert.equal(profitableNoReductionQuote(pos(10,8.6,.08),book(.90),m(),{feeMultiplier:6}),null);
});
