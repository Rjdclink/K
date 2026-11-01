import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {filledComboWindow,availableComboFills,heldComboLeg,comboAllocation,plannedComboGroups,singleSpendableCash} from '../src/combos.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const functionSource=(name,next)=>source.slice(source.indexOf('async function '+name+'('),source.indexOf('async function '+next+'('));
const order={id:'fill-id',market_ticker:'NEW',strategy:'lead',count:10,limit_price:.95,created_at:new Date(Date.now()-60000),updated_at:new Date(Date.now()-30000),retries:0};
function harness({filled=2,recovery=false,retry=false,age=0,balance=10000}={}){
  const events=[];
  const context=vm.createContext({console,Date,URLSearchParams,JSON,Math,Number,singleSpendableCash,
    pool:{query:async(sql,values)=>{
      if(sql.startsWith('SELECT * FROM trade_attempts'))return {rows:[order]};
      if(sql.startsWith('UPDATE trade_attempts'))events.push(['ledger',values]);
      return {rows:[],rowCount:sql.includes("SET retries=1")?1:0};
    }},profitableCount:n=>n,contractCount:cash=>cash>=950?10:0,feeReserve:()=>2,estimatedCostCents:()=>950,minimumThreeGoalSpend:()=>0,soccerWinnerWindowOpen:()=>true,
    reserve:async()=>order.id,withEntryProfitFloor:async(_,send)=>send(),
    kalshi:async path=>path.startsWith('/portfolio/orders')?{orders:retry?[]:[{client_order_id:order.id,fill_count_fp:String(filled),order_id:'exchange'}]}:{fill_count_fp:String(filled),order_id:'exchange'},
    confirmedSingleFill:async(id,ticker)=>events.push(['notify',id,ticker]),reviewMiss:async()=>({retry:true,reason:'verified recovery'})});
  const name=recovery?'recoverPending':'submit';
  vm.runInContext(functionSource(name,recovery?'reconcileUpgrade':'recoverPending'),context);
  return {events,run:()=>context[name]({strategy:'lead',reason:'Alpha leads',fraction:.1},{id:'game',type:'football_game',verificationId:'verified',observedAt:Date.now()-age},
    {event_ticker:'E'},{ticker:'NEW',yes_ask_dollars:'.95'},balance,10000)};
}
test('confirmed immediate fills notify after ledger persistence; zero fills never notify',async()=>{
  for(const filled of [0,2]){
    const h=harness({filled});assert.equal(await h.run(),filled>0);
    assert.equal(h.events.filter(e=>e[0]==='notify').length,filled>0?1:0);
    if(filled){assert.equal(h.events[0][0],'ledger');assert.deepEqual(h.events.at(-1),['notify','fill-id','NEW'])}
  }
});
test('new and retried singles preserve the combo cash floor',async()=>{
 for(const recovery of [false,true])assert.equal(await harness({recovery,retry:recovery,balance:1600}).run(),false);
 assert.equal(await harness({balance:1700}).run(),true);
});
test('both recovered existing fills and confirmed retry fills notify the combo checker',async()=>{
  for(const retry of [false,true]){
    const h=harness({recovery:true,retry});assert.equal(await h.run(),true);
    assert.deepEqual(h.events.at(-1),['notify','fill-id','NEW']);
    const zero=harness({filled:0,recovery:true,retry});assert.equal(await zero.run(),false);
    assert.equal(zero.events.some(e=>e[0]==='notify'),false);
  }
});
test('a lead older than thirty seconds cannot submit or retry its order',async()=>{
 for(const recovery of [false,true]){const h=harness({recovery,retry:recovery,age:31000});assert.equal(await h.run(),false);assert.equal(h.events.length,0)}
});
test('the immediate check reloads held fills, bypasses the retry timer, and uses both new and old positions',async()=>{
  const rows=['OLD','NEW'].map((ticker,i)=>({...order,id:'id-'+i,market_ticker:ticker,event_ticker:'E'+i,game_id:'G'+i,
    fill_count:2,status:'filled',combo_legs:null,sport:'NFL',updated_at:new Date()}));
  let execution,claim,positionReads=0,executions=0;const claims=new Set();
  const context=vm.createContext({console,Date,JSON,Number,Set,Map,Promise,setTimeout,
    live:()=>true,upgradeTables:async()=>{},ensureScoreTime:async()=>{},
    allOpenPositions:async()=>({market_positions:(++positionReads===1?rows.slice(0,1):rows).map(r=>({ticker:r.market_ticker,position_fp:'2'}))}),
    availableComboFills,filledComboWindow,heldComboLeg,comboAllocation,
    accountBalance:async()=>({balance:1000,portfolio_value:500}),
    kalshi:async path=>{const row=rows.find(r=>path.endsWith(r.market_ticker));return {market:{ticker:row.market_ticker,event_ticker:row.event_ticker,status:'active'}}},
    pool:{query:async(sql,args)=>{
      if(sql.includes("FROM trade_attempts a WHERE a.status='filled'"))return {rows};
      if(sql.startsWith('SELECT started_at'))return {rows:[{started_at:new Date()}]};
      if(sql.includes('INSERT INTO combo_fill_triggers')){claim=args[0];const exists=claims.has(claim);claims.add(claim);return {rows:exists?[]:[{}],rowCount:exists?0:1}}
      if(sql.includes("interval '2 minutes'"))throw Error('Immediate fill must bypass scheduled retry delay');
      return {rows:[],rowCount:0};
    }},executeCombo:async(...args)=>{execution=args;executions++;return {filled:false,pending:false}}});
  vm.runInContext(functionSource('checkCurrentHeldCombinations','diagnoseUnfilledCombo'),context);
  await context.checkCurrentHeldCombinations({id:'id-1',market_ticker:'NEW'},{verifiedSince:new Date(),superseded:()=>false});
  assert.equal(claim,'id-1');assert.deepEqual(Array.from(execution[0],c=>c.market.ticker).sort(),['NEW','OLD']);
  assert.equal(execution[4],'NEW');
  assert.equal(positionReads,2,'brief account-position lag is retried immediately');
  await context.checkCurrentHeldCombinations({id:'id-1',market_ticker:'NEW'},{verifiedSince:new Date(),superseded:()=>false});
  assert.equal(executions,1,'a repeated confirmed fill cannot launch a second ticket attempt');
});
test('immediate planner includes the newly filled leg even at a high historical rotation',()=>{
  const legs=Array.from({length:30},(_,i)=>({market:{ticker:'M'+i},event:{event_ticker:'E'+i}}));
  const collections=[{collection_ticker:'C',is_all_yes:true,size_min:2,size_max:4,is_single_market_per_event:true,
    associated_event_tickers:legs.map(l=>l.event.event_ticker)}];
  const plans=plannedComboGroups(collections,legs,12,1000,new Set(),'M29');
  assert.ok(plans.length>0);assert.ok(plans.every(p=>p.legs.some(l=>l.market.ticker==='M29')));
  assert.ok(plans.some(p=>p.legs.length===2));
  assert.deepEqual(plannedComboGroups(collections,legs,12,1000,new Set(),'NOT-HELD'),[]);
});
test('fast, weather, and upgrade paths share confirmed-fill notification; RFQs do not recursively trigger it',()=>{
  assert.match(functionSource('reconcileUpgrade','upgradeHeldOver'),/if\(filled>0\)await confirmedSingleFill\(row.id,row.market_ticker\)/);
  assert.match(functionSource('upgradeHeldOver','immediatelyUpgradeFilledOver'),/if\(filled>0\)await confirmedSingleFill\(id,quote.ticker\)/);
  assert.match(source,/fillComboQueue.run\(\(\)=>handleRequest\(req\)\)/);
  assert.doesNotMatch(functionSource('reconcileCombos','reconcileComboUpgrades'),/confirmedSingleFill/);
  const execute=source.slice(source.indexOf('async function executeCombo('),source.indexOf('async function checkCurrentHeldCombinations('));
  assert.match(execute,/while\(Date.now\(\)<deadline&&!superseded\(\)\)/);
  assert.match(execute,/finally\{await Promise.all\(plans.map/,'superseded RFQs are cancelled');
});
