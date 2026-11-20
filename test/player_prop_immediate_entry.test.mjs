import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');

test('cushioned player candidate reports immediate external verification, not pending or countdown, including cash transfer',()=>{
  const block=source.slice(source.indexOf('function signalExecution('),source.indexOf('async function ensureShardFunding('));
  const context=vm.createContext({
    process:{env:{}},signalKey:()=> 'P:over',hasAsk:()=>true,feeReserve:()=>2,singleSpendableCash:()=>10000,
    contractCount:()=>10,minimumThreeGoalSpend:()=>0,estimatedCostCents:()=>900,
    profitableCount:()=>10,marketShard:()=>0,shardCash:()=>10000,transferPlan:()=>({amountCenticents:90000}),
    netSettlementProfitCents:()=>200,playerOverSpec:()=>({metric:'REB'}),overCushion:()=>1,
    proBasketballLeadRules:()=>false,BASKETBALL_WINNER_ENTRY_SECONDS:105
  });
  vm.runInContext(block,context);
  const current={state:{type:'basketball_game'},market:{yes_ask_dollars:'.89',yes_ask_size_fp:'10'},
    event:{event_ticker:'E'},signal:{strategy:'over',fraction:.1}};
  const fn=context.signalExecution;
  assert.match(fn(current,new Set(),{balance:10000},10000,10000),/independent player.stat.*immediately before entry/i);
  assert.doesNotMatch(fn(current,new Set(),{balance:10000},10000,10000),/pending|waiting|countdown/i);
  context.shardCash=()=>0;
  assert.match(fn(current,new Set(),{balance:10000},10000,10000),/shard transfer.*immediate/i);
  assert.doesNotMatch(fn(current,new Set(),{balance:10000},10000,10000),/verification pending/i);
  context.overCushion=()=>null;
  assert.match(fn(current,new Set(),{balance:10000},10000,10000),/extra|additional|cushion/i);
});

test('a last-moment independent proof is mandatory for player-prop entry and both new buys and upgrades use it',async()=>{
  const begin=source.indexOf('async function freshPlayerPropForEntry(');
  assert.notEqual(begin,-1,'a dedicated just-in-time player proof gate must exist');
  const end=source.indexOf('async function submit(',begin);
  assert.ok(end>begin,'player-prop proof helper is directly before the submit path');
  let called=0,valid=true;
  const market={ticker:'P'},game={id:'g'},milestone={id:'g'};
  const context=vm.createContext({
    playerOverSpec:()=>({metric:'STL'}),overCushion:()=>1,
    confirmedIndependentOver:async()=>{called++;return {...game,verificationId:'fresh-'+called}},
    timedOverEntryValid:()=>valid
  });
  vm.runInContext(source.slice(begin,end),context);
  const fn=context.freshPlayerPropForEntry;
  assert.equal((await fn(game,milestone,market))?.verificationId,'fresh-1');
  assert.equal((await fn(game,milestone,market))?.verificationId,'fresh-2','never reuse worker preflight');
  valid=false;
  assert.equal(await fn(game,milestone,market),null,'invalid or expired final external proof blocks entry');
  context.overCushion=()=>null;
  assert.equal(await fn(game,milestone,market),null,'no new external lookup can authorize an uncushioned prop');
  assert.equal(called,3);
  const buyPath=source.slice(source.indexOf("stage='submission';"),source.indexOf('await Promise.all([workersDone'));
  const upgradePath=source.slice(source.indexOf('async function upgradeHeldOver('),source.indexOf('async function immediatelyUpgradeFilledOver('));
  assert.match(buyPath,/freshPlayerPropForEntry\(/,'new buys reverify after cash and funding checks');
  assert.match(upgradePath,/freshPlayerPropForEntry\(/,'held-position add-ons also reverify at entry');
});