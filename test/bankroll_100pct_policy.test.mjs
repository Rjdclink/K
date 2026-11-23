import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automaticEntryFraction,automaticEntryCapCents,ORDINARY_ENTRY_MAX_FRACTION,hasIndependentCushionedOverProof} from '../src/automatic_entry_policy.mjs';
import {orderSize,estimatedCostCents,overBudget,minimumProfitCents} from '../src/strategy.mjs';
import {remainingVerifiedOverCents} from '../src/upgrades.mjs';
import {comboAllocation,comboAllowedCents,comboLegAllocation,remainingVerifiedComboCents} from '../src/combos.mjs';
import {manualComboQuote} from '../src/combo_manual.mjs';
import {remainingMentionCents,MENTION_MAX_FRACTION} from '../src/mentions.mjs';

test('every valid strategy tier receives the full fee-inclusive bankroll ceiling',()=>{
 assert.equal(ORDINARY_ENTRY_MAX_FRACTION,1);
 for(const strategy of ['no','lead','over','weather','combo','mention_yes','mention_no'])
  for(const fraction of [.02,.05,.10,.15,.20,.25,.40,.45,.60,.80,1]){
   assert.equal(automaticEntryFraction({strategy,fraction}),1,strategiesLabel(strategy,fraction));
   assert.equal(automaticEntryCapCents({strategy,fraction},10000),10000);
  }
 for(const fraction of [0,-1,NaN,Infinity])assert.equal(automaticEntryFraction({strategy:'lead',fraction}),0);
});
const strategiesLabel=(strategy,fraction)=>strategy+' signal tier '+fraction;

test('order size is fee-inclusive, never exceeding available cash or 100% of bankroll',()=>{
 const count=orderSize(100000,.5,10000,.05,1,100000,Infinity,2,{strategy:'lead'});
 assert.ok(estimatedCostCents(count,.5,2)>15000);
 assert.ok(estimatedCostCents(count,.5,2)<=100000);
 assert.ok(estimatedCostCents(count+.01,.5,2)>100000);
 const limited=orderSize(10000,.5,10000,.25,1,100000,Infinity,2,{strategy:'over'});
 assert.ok(estimatedCostCents(limited,.5,2)<=10000);
 assert.equal(overBudget(10000,20000),30000);
});

test('old add-on fractions are labels, not bankroll ceilings',()=>{
 const position={position_fp:'10',market_exposure_dollars:'29',fees_paid_dollars:'1'};
 for(const fraction of [.10,.15,.20,.25,.40,.45,.60])
  assert.equal(remainingVerifiedOverCents(position,100000,fraction),97000);
 assert.equal(remainingVerifiedOverCents({...position,fees_paid_dollars:null},100000,.60),0);
 assert.equal(comboAllocation(),1);
 assert.equal(comboLegAllocation([{signal:{strategy:'lead'}}],.15),1);
 assert.equal(comboAllowedCents(.15,10000),10000);
 assert.equal(remainingVerifiedComboCents({position_fp:'2',market_exposure_dollars:'3',fees_paid_dollars:'.25'},10000,.15),9675);
 assert.equal(MENTION_MAX_FRACTION,1);
 assert.equal(remainingMentionCents(10000,1000,2000),7000);
});

test('manual combination additions count all existing cost and fees under 100%',()=>{
 const market={status:'active',fractional_trading_enabled:true};
 const position={position_fp:'2',market_exposure_dollars:'3',fees_paid_dollars:'.25'};
 const book={no_dollars:[['0.20','1000']]};
 const quote=manualComboQuote(market,book,position,{balance:10000,portfolio_value:0},.15);
 assert.ok(quote.count>0,quote.reason);
 assert.ok(quote.max_cost_cents>1500);
 assert.ok(quote.max_cost_cents+325<=10000);
 assert.equal(manualComboQuote(market,book,position,{balance:0,portfolio_value:10000}).count,undefined);
});

test('sport and verification rules are preserved, with only bankroll pools changed',()=>{
 const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 for(const fragment of ['open.size>5','minimumProfitCents(strategy,latestBankroll',
  'assertOverExposure(game,market,signal.fraction)','assertFreshLead(game,market)',
  'Math.floor(bankroll*allocation)-held-unreported','const allocation=1',
  'remainingMentionCents(total,latestExposure.heldCents,latestExposure.pendingCents)'])
  assert.ok(code.includes(fragment),fragment);
 assert.equal(minimumProfitCents('lead',10000),1);
 assert.equal(minimumProfitCents('no',10000,'',NaN,0,{costCents:10000}),100);
 assert.equal(hasIndependentCushionedOverProof({overVerification:{route:'cushion'}}),false);
});

test('dashboard exposes the new actual ceiling and retains profit requirements',()=>{
 const ui=readFileSync(new URL('../src/ui.mjs',import.meta.url),'utf8');
 for(const phrase of ['maximum 100% of bankroll','100% bankroll maximum','100% maximum bankroll allocation per trade','at least 1% net profit after fees'])
  assert.ok(ui.includes(phrase),phrase);
 assert.ok(!ui.includes('15% maximum bankroll'));
});
