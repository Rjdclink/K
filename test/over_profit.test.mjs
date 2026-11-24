import {tradeBudgetCents,MAX_TRADE_CENTS} from '../src/automatic_entry_policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {minimumProfitCents,netSettlementProfitCents,profitableCount,estimatedCostCents} from '../src/strategy.mjs';
import {automaticEntryFraction} from '../src/automatic_entry_policy.mjs';
import {filledOrderGateCount} from '../src/entry_floor.mjs';

const minimum=costCents=>minimumProfitCents('no',0,'',NaN,0,{costCents});

test('every strategy requires one percent of the fee-inclusive wager in net settlement profit',()=>{
 assert.equal(minimum(100),1);
 assert.equal(minimum(101),2);
 assert.equal(minimum(9871),99);
 assert.equal(minimum(9906),100);
 for(const strategy of ['over','lead','no','weather','combo','mention']){
  assert.equal(minimumProfitCents(strategy,100000,'',NaN,25,{costCents:9906}),100,strategy);
  assert.equal(profitableCount(100,.988,2,strategy,100000),100,strategy);
  assert.equal(profitableCount(100,.989,2,strategy,100000),0,strategy);
 }
 assert.equal(estimatedCostCents(100,.989,2),9906);
 assert.equal(netSettlementProfitCents(100,.989,2),94);
 assert.equal(profitableCount(1,.99,2,'lead',10000),0,'zero post-fee profit never qualifies');
});

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('async function withEntryProfitFloor('),source.indexOf('async function milestones('));

test('final exchange gate enforces the ratio for automatic and manual purchases',async()=>{
 for(const manual of [false,true])for(const [price,allowed] of [[.988,true],[.989,false]]){
  let sends=0,released=false;
  const positions={market_positions:manual?[{ticker:'T',position_fp:'1',market_exposure_dollars:'1',fees_paid_dollars:'0'}]:[]};
  const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?[{acquired:true}]:[],rowCount:0}),release:()=>{released=true}};
  const context=vm.createContext({ensureManualCombos:async()=>{},tradeBudgetCents,MAX_TRADE_CENTS,upgradeTables:async()=>{},setTimeout,minimumProfitCents,netSettlementProfitCents,estimatedCostCents,automaticEntryFraction,filledOrderGateCount,
    pool:{connect:async()=>client},accountBalance:async()=>({balance:100000,portfolio_value:0}),
    allOpenPositions:async()=>positions});
  vm.runInContext(gate,context);
  const result=await context.withEntryProfitFloor({ticker:'T',count:100,price,fees:2,strategy:'lead',bankroll:100000,
    fraction:1,manual,maxCostCents:estimatedCostCents(100,price,2)},async()=>{sends++;return 'sent'});
  assert.equal(result,allowed?'sent':null,`${manual?'manual':'automatic'} ${price}`);
  assert.equal(sends,allowed?1:0);
  assert.equal(released,true);
 }
});
