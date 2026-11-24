import {tradeBudgetCents,MAX_TRADE_CENTS} from '../src/automatic_entry_policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {estimatedCostCents} from '../src/strategy.mjs';
import {automaticEntryFraction} from '../src/automatic_entry_policy.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('async function withEntryProfitFloor('),
 source.indexOf('async function ensureStaleReviewTable()'));
async function attempt({balance,portfolio=0,count=100,manual=false,exposure='0',paidFees='0',maxCostCents,held=[],pending=[]}={}){
 let sent=0;
 const position={ticker:'GAME',position_fp:'1',market_exposure_dollars:exposure,fees_paid_dollars:paidFees};
 const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?
  [{acquired:true}]:sql.includes('UNION ALL')?pending:[],rowCount:0}),release(){}};
 const context=vm.createContext({setTimeout,ensureManualCombos:async()=>{},tradeBudgetCents,MAX_TRADE_CENTS,upgradeTables:async()=>{},
  pool:{connect:async()=>client},allOpenPositions:async()=>({market_positions:manual?[position,...held]:held}),
  accountBalance:async()=>({balance,portfolio_value:portfolio}),
  estimatedCostCents,automaticEntryFraction,minimumProfitCents:()=>0,
  netSettlementProfitCents:()=>100,filledOrderGateCount:()=>0});
 vm.runInContext(gate,context);
 const result=await context.withEntryProfitFloor({ticker:'GAME',count,price:.5,fees:2,
  strategy:'lead',fraction:.1,bankroll:100000,manual,maxCostCents},async()=>{sent++;return 'sent'});
 return {result,sent};
}
test('final automatic buy uses fresh account, with fees, up to exactly 100%',async()=>{
 const cost=estimatedCostCents(100,.5,2);
 assert.deepEqual(await attempt({balance:cost}),{result:'sent',sent:1});
 assert.deepEqual(await attempt({balance:cost-1}),{result:null,sent:0});
 assert.deepEqual(await attempt({balance:cost-1,portfolio:10000}),{result:null,sent:0},
  'portfolio value cannot replace the cash required to settle a buy');
});
test('one order cannot exceed $200 and all open and pending purchases share one bankroll',async()=>{
 const cost=estimatedCostCents(100,.5,2);
 for(const manual of [true,false]){
  const options={manual,balance:100000,maxCostCents:21400,count:400};
  assert.equal((await attempt(options)).sent,0);
  const held=[{ticker:'OTHER',position_fp:'-10',market_exposure_dollars:'60',fees_paid_dollars:'0'}];
  assert.equal((await attempt({manual,balance:cost,portfolio:6000,held,maxCostCents:cost})).sent,1);
  assert.equal((await attempt({manual,balance:cost,portfolio:5999,held,maxCostCents:cost})).sent,0);
  assert.equal((await attempt({manual,balance:cost,portfolio:6000,held,maxCostCents:cost,
    pending:[{count:1,limit_price:.5}]})).sent,0);
 }
});
test('risk sizing uses the external margin, remaining time, price and the smaller of bankroll or $200',()=>{
 const market={event_ticker:'KXEPLTOTAL-X',floor_strike:2.5};
 function budget(strategy,total,minute,price=.95,bankroll=100000){
  const score={gameId:'g',eventId:'verified',home:total,away:0,elapsedMinute:minute};
  const game={id:'g',type:'soccer_match',home:10,away:10,soccerMinute:minute,
   externalScore:score,independentEntry:{score}};
  return tradeBudgetCents({strategy,game,market,price},bankroll);
 }
 assert.ok(budget('no',1,82)<budget('no',0,82));
 assert.ok(budget('no',1,82)<budget('no',1,89));
 assert.ok(budget('lead',4,82)>budget('lead',3,82));
 assert.ok(budget('lead',4,89)>budget('lead',4,82));
 assert.ok(budget('lead',4,89,.98)<budget('lead',4,89,.90));
 assert.ok(budget('lead',5,92)<20000);
 assert.ok(budget('no',0,82,.95,10000)<=10000);
 assert.equal(budget('lead',4,92),budget('lead',4,96));
 assert.equal(tradeBudgetCents({strategy:'no',game:{type:'soccer_match'},market,price:.95},10000),0);
});
test('manual add-on counts held cost and its reserved fee against fresh bankroll',async()=>{
 const cost=estimatedCostCents(100,.5,2),held=4000;
 assert.deepEqual(await attempt({balance:cost,portfolio:held,manual:true,exposure:'40',
  maxCostCents:cost}),{result:'sent',sent:1});
 assert.deepEqual(await attempt({balance:cost,portfolio:held-1,manual:true,exposure:'40',
  maxCostCents:cost}),{result:null,sent:0});
 assert.deepEqual(await attempt({balance:cost,portfolio:held,manual:true,exposure:'39.99',
  paidFees:'.01',maxCostCents:cost+1}),{result:null,sent:0});
});
