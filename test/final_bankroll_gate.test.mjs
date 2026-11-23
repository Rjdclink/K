import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {estimatedCostCents} from '../src/strategy.mjs';
import {automaticEntryFraction} from '../src/automatic_entry_policy.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('async function withEntryProfitFloor('),
 source.indexOf('async function ensureStaleReviewTable()'));
async function attempt({balance,portfolio=0,count=100,manual=false,exposure='0',paidFees='0',maxCostCents}={}){
 let sent=0;
 const position={ticker:'GAME',position_fp:'1',market_exposure_dollars:exposure,fees_paid_dollars:paidFees};
 const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?
  [{acquired:true}]:[],rowCount:0}),release(){}};
 const context=vm.createContext({setTimeout,ensureManualCombos:async()=>{},
  pool:{connect:async()=>client},allOpenPositions:async()=>({market_positions:manual?[position]:[]}),
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
test('manual add-on counts held cost and its reserved fee against fresh bankroll',async()=>{
 const cost=estimatedCostCents(100,.5,2),held=4000;
 assert.deepEqual(await attempt({balance:cost,portfolio:held,manual:true,exposure:'40',
  maxCostCents:cost}),{result:'sent',sent:1});
 assert.deepEqual(await attempt({balance:cost,portfolio:held-1,manual:true,exposure:'40',
  maxCostCents:cost}),{result:null,sent:0});
 assert.deepEqual(await attempt({balance:cost,portfolio:held,manual:true,exposure:'39.99',
  paidFees:'.01',maxCostCents:cost+1}),{result:null,sent:0});
});
