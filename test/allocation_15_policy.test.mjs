import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automaticEntryFraction,ORDINARY_ENTRY_MAX_FRACTION} from '../src/automatic_entry_policy.mjs';
import {orderSize,overBudget,estimatedCostCents} from '../src/strategy.mjs';
import {comboAllocation,comboAllowedCents,comboLegAllocation,remainingVerifiedComboCents,comboHeldFraction} from '../src/combos.mjs';
import {manualComboQuote} from '../src/combo_manual.mjs';
import {independentlyVerifiedLeadFraction,directLeadFraction,finalLeadFraction} from '../src/lead_allocation.mjs';

test('ordinary NO, leads, OVER without cushion, weather and combinations are capped at fifteen percent, never more',()=>{
 assert.equal(ORDINARY_ENTRY_MAX_FRACTION,.15);
 for(const strategy of ['no','lead','over','weather','combo','mention_yes','mention_no']){
  assert.equal(automaticEntryFraction({strategy,fraction:.80}),.15,strategy);
  assert.equal(automaticEntryFraction({strategy,fraction:.15}),.15,strategy);
  assert.equal(automaticEntryFraction({strategy,fraction:.10}),.10,'lower risk signals stay lower');
 }
 for(const fraction of [0,-1,NaN,Infinity])assert.equal(automaticEntryFraction({strategy:'lead',fraction}),0);
 const cash=100000,bankroll=100000,price=.50;
 const count=orderSize(cash,String(price),'2000',.8,1,bankroll,Infinity,2);
 assert.equal(count,orderSize(cash,String(price),'2000',.15,1,bankroll,Infinity,2));
 assert.ok(estimatedCostCents(count,price,2)<=15000);
 assert.ok(estimatedCostCents(count+.01,price,2)>15000);
 assert.equal(overBudget(10000,0),1500);
});

test('verified independent cushioned OVER fractions retain established tiers unchanged, with no unverified bypass',()=>{
 const base={strategy:'over',fraction:.60};
 for(const [fraction,route] of [[.25,'cushion'],[.40,'seller_cushion'],[.45,'cushion'],[.60,'cushion']]){
  const game={verificationId:'proof',independentEntry:{verificationId:'proof'},overVerification:{route}};
  assert.equal(automaticEntryFraction({...base,fraction,game}),fraction);
  assert.equal(automaticEntryFraction({...base,fraction,game:{...game,independentEntry:{verificationId:'stale'}}}),.15);
 }
 assert.equal(automaticEntryFraction({...base,game:{overVerification:{route:'cushion'}}}),.15);
});

test('automatic and manual combinations receive the same fee-inclusive fifteen-percent aggregate ceiling',()=>{
 assert.equal(comboAllocation(),.15);
 assert.equal(comboAllowedCents(.35,10000),1500);
 assert.equal(comboAllowedCents(.10,10000),1000);
 const verified=[{signal:{strategy:'lead',externallyVerified:true}},{signal:{strategy:'over',externallyVerified:true}}];
 assert.equal(comboLegAllocation(verified,.35),.15);
 assert.equal(comboHeldFraction(verified.map(x=>({strategy:x.signal.strategy,externallyVerified:true}))),.15);
 const position={position_fp:'5',market_exposure_dollars:'3',fees_paid_dollars:'.25'};
 assert.equal(remainingVerifiedComboCents(position,10000,.50),1175);
 const market={status:'active',fractional_trading_enabled:true};
 const book={no_dollars:[['0.20','200']]};
 const account={balance:10000,portfolio_value:0};
 const quote=manualComboQuote(market,book,position,account,.40);
 assert.ok(quote.count>0,quote.reason);
 assert.ok(quote.max_cost_cents+325<=1500,'existing held exposure and fees deducted from the 15% combo allocation');
});

test('all four total NO sport pools use 15%, including shared football, hockey, soccer and early-quarter exposure',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const segments=[
  ['async function scanCollegeTotalNos(','async function scanHockeyTotalNos('],
  ['async function scanHockeyTotalNos(','async function scanEarlyPeriodNos('],
  ['async function scanEarlyPeriodNos(','async function scanSoccerTotalNos('],
  ['async function scanSoccerTotalNos(','async function scanNoncushionedPlayerOvers(']
 ];
 for(const [first,last] of segments){
  const s=code.slice(code.indexOf(first),code.indexOf(last,code.indexOf(first)+1));
  assert.ok(s.includes('allocation=.15'),first+' must use fifteen percent');
  assert.ok(s.includes('Math.floor(bankroll*allocation)-held-unreported'),first+' must deduct existing exposure and fees');
 }
});

test('unverified hockey/soccer lead and special restricted proof routes never evade the new fifteen-percent maximum',()=>{
 const game={type:'hockey_match',sport:'NHL',homeUnits:3,awayUnits:0};
 const market={ticker:'m'};
 const lead={strategy:'lead',fraction:.30};
 assert.ok(independentlyVerifiedLeadFraction(game,market)<=.15);
 assert.ok(directLeadFraction(game,lead,market)<=.15);
 assert.ok(finalLeadFraction(game,game,lead,true,market)<=.15);
});

test('the five unsettled uncushioned player-prop slots and their profit floor remain mandatory',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(code,/open\.size>5/);
 assert.match(code,/minimumProfitCents\(strategy,bankroll/);
 assert.match(code,/withEntryProfitFloor\(/);
});

test('official mentions, zero-yardage NO, and uncushioned player preview use the fifteen-percent ceiling consistently',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(code,/orderSize\(spendable,ask\.price,ask\.size,\.15,\.40,bankroll,budget,fee\)/);
 assert.match(code,/Math\.floor\(bankroll\*\.15\)-Math\.max\(accounted,baselineHeld\+spent\)/);
 assert.match(code,/orderSize\(Math\.min\(singleSpendableCash\(account\.balance\),local\),price,ask\.size,\.15,1,bankroll,budget,fees\)/);
 assert.match(code,/quote,\.15,bankroll,Infinity,fees,\{strategy:'over',game:c\.state\}/);
});

test('dashboard allocation descriptions match the new ordinary limit without altering cushioned OVER tier descriptions',()=>{
 const ui=readFileSync(new URL('../src/ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/maximum 15% of bankroll/);
 assert.match(ui,/15% bankroll maximum/);
 assert.match(ui,/15% maximum bankroll allocation per trade/);
 for(const value of ['10% maximum for basketball countable props','25% for other countable props','40% for a one-play non-player cushion','45% for a verified double cushion','60% for a verified triple cushion'])
  assert.ok(ui.includes(value),value);
});