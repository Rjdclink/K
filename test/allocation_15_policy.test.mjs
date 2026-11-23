import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automaticEntryFraction,ORDINARY_ENTRY_MAX_FRACTION} from '../src/automatic_entry_policy.mjs';
import {orderSize,overBudget,estimatedCostCents} from '../src/strategy.mjs';
import {comboAllocation,comboAllowedCents,comboLegAllocation,remainingVerifiedComboCents,comboHeldFraction} from '../src/combos.mjs';
import {manualComboQuote} from '../src/combo_manual.mjs';
import {independentlyVerifiedLeadFraction,directLeadFraction,finalLeadFraction} from '../src/lead_allocation.mjs';

test('ordinary NO, leads, OVER without cushion, weather and combinations are capped at 100 percent, never more',()=>{
 assert.equal(ORDINARY_ENTRY_MAX_FRACTION,1);
 for(const strategy of ['no','lead','over','weather','combo','mention_yes','mention_no']){
  assert.equal(automaticEntryFraction({strategy,fraction:.80}),1,strategy);
  assert.equal(automaticEntryFraction({strategy,fraction:.15}),1,strategy);
  assert.equal(automaticEntryFraction({strategy,fraction:.10}),1,'strategy signal tiers do not impose a lower spending limit');
 }
 for(const fraction of [0,-1,NaN,Infinity])assert.equal(automaticEntryFraction({strategy:'lead',fraction}),0);
 const cash=100000,bankroll=100000,price=.50;
 const count=orderSize(cash,String(price),'2000',.8,1,bankroll,Infinity,2);
 assert.equal(count,orderSize(cash,String(price),'2000',.15,1,bankroll,Infinity,2));
 assert.ok(estimatedCostCents(count,price,2)<=100000);
 assert.ok(estimatedCostCents(count+.01,price,2)>100000);
 assert.equal(overBudget(10000,0),10000);
});

test('verified independent cushioned OVER proof remains enforced, but old fractional ceilings no longer cap spending',()=>{
 const base={strategy:'over',fraction:.60};
 for(const [fraction,route] of [[.25,'cushion'],[.40,'seller_cushion'],[.45,'cushion'],[.60,'cushion']]){
  const game={verificationId:'proof',independentEntry:{verificationId:'proof'},overVerification:{route}};
  assert.equal(automaticEntryFraction({...base,fraction,game}),1);
  assert.equal(automaticEntryFraction({...base,fraction,game:{...game,independentEntry:{verificationId:'stale'}}}),1);
 }
 assert.equal(automaticEntryFraction({...base,game:{overVerification:{route:'cushion'}}}),1);
});

test('automatic and manual combinations receive the same fee-inclusive 100-percent aggregate ceiling',()=>{
 assert.equal(comboAllocation(),1);
 assert.equal(comboAllowedCents(.35,10000),10000);
 assert.equal(comboAllowedCents(.10,10000),10000);
 const verified=[{signal:{strategy:'lead',externallyVerified:true}},{signal:{strategy:'over',externallyVerified:true}}];
 assert.equal(comboLegAllocation(verified,.35),1);
 assert.equal(comboHeldFraction(verified.map(x=>({strategy:x.signal.strategy,externallyVerified:true}))),1);
 const position={position_fp:'5',market_exposure_dollars:'3',fees_paid_dollars:'.25'};
 assert.equal(remainingVerifiedComboCents(position,10000,.50),9675);
 const market={status:'active',fractional_trading_enabled:true};
 const book={no_dollars:[['0.20','200']]};
 const account={balance:10000,portfolio_value:0};
 const quote=manualComboQuote(market,book,position,account,.40);
 assert.ok(quote.count>0,quote.reason);
 assert.ok(quote.max_cost_cents+325<=10000,'existing held exposure and fees deducted from the 100% combo allocation');
});

test('all four total NO sport pools use 100%, including shared football, hockey, soccer and early-quarter exposure',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const segments=[
  ['async function scanCollegeTotalNos(','async function scanHockeyTotalNos('],
  ['async function scanHockeyTotalNos(','async function scanEarlyPeriodNos('],
  ['async function scanEarlyPeriodNos(','async function scanSoccerTotalNos('],
  ['async function scanSoccerTotalNos(','async function scanNoncushionedPlayerOvers(']
 ];
 for(const [first,last] of segments){
  const s=code.slice(code.indexOf(first),code.indexOf(last,code.indexOf(first)+1));
  assert.ok(s.includes('allocation=1'),first+' must use 100 percent');
  assert.ok(s.includes('Math.floor(bankroll*allocation)-held-unreported'),first+' must deduct existing exposure and fees');
 }
});

test('unverified hockey/soccer lead proof route metadata is unchanged while the spending limit is universal',()=>{
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

test('official mentions, zero-yardage NO, and uncushioned player preview use the full-bankroll ceiling consistently',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(code,/orderSize\(spendable,ask\.price,ask\.size,\.15,\.40,bankroll,budget,fee\)/);
 assert.match(code,/Math\.floor\(bankroll\)-Math\.max\(accounted,baselineHeld\+spent\)/);
 assert.match(code,/orderSize\(Math\.min\(singleSpendableCash\(account\.balance\),local\),price,ask\.size,\.15,1,bankroll,budget,fees\)/);
 assert.match(code,/quote,\.15,bankroll,Infinity,fees,\{strategy:'over',game:c\.state\}/);
});

test('dashboard allocation descriptions use 100% while retaining cushioned OVER proof and special profit tiers',()=>{
 const ui=readFileSync(new URL('../src/ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/maximum 100% of bankroll/);
 assert.match(ui,/100% bankroll maximum/);
 assert.match(ui,/100% maximum bankroll allocation per trade/);
 for(const value of ['All player-prop entries are disabled','one-play, double-cushion and triple-cushion proof requirements','Previously held positions, exit controls and settled history remain available'])
  assert.ok(ui.includes(value),value);
});