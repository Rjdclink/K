import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {thirdQuarterYardageNo,highestYardageNos,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {verifyIndependentYardageZero} from '../src/score_verification.mjs';
import {assertExternalPurchase,rememberIndependentEntry} from '../src/entry_verification.mjs';
import {completedNoTrade} from '../src/history.mjs';
import {orderSize,estimatedCostCents} from '../src/strategy.mjs';
const fixture=JSON.parse(readFileSync(new URL('fixtures/phi-was-verification.json',import.meta.url)));
const now=Date.now(),id='320ff933-d015-48c1-bc6f-13058dc633f8';
const game={...fixture.game,period:3,observedAt:now,playerStats:{[id]:{receiving_yards:0,rushing_yards:0}}};
const market=line=>({ticker:`KXNFLRECYDS-GAME-${line}`,event_ticker:'KXNFLRECYDS-GAME',status:'active',
  result:'not_determined',floor_strike:line-.5,custom_strike:{football_player:id},
  yes_sub_title:`Chig Okonkwo: ${line}+`,rules_primary:`Resolves Yes if Chig Okonkwo records ${line}+ receiving yards in the game.`});

test('only zero-yard Q3 binary 100+ yardage thresholds qualify',()=>{
  assert.equal(thirdQuarterYardageNo(game,market(100))?.line,99.5);
  assert.equal(thirdQuarterYardageNo(game,market(90)),null);
  assert.equal(thirdQuarterYardageNo({...game,period:4},market(100)),null);
  assert.equal(thirdQuarterYardageNo({...game,playerStats:{[id]:{receiving_yards:1}}},market(100)),null);
  assert.equal(thirdQuarterYardageNo(game,{...market(100),event_ticker:'KXNFLRECYDSPROT-GAME'}),null);
  assert.equal(thirdQuarterYardageNo(game,{...market(100),rules_primary:'Each yard increases payout as a ladder'}),null);
  assert.equal(thirdQuarterYardageNo(game,{...market(100),custom_strike:{}}),null);
});
test('highest threshold is selected per player and stat; cheaper NO asks rank first',()=>{
  const c=(line,price)=>({game,player:{id,metric:'RECYDS',line:line-.5},market:{...market(line),no_ask_dollars:price}});
  const other={...c(100,.96),player:{id:'other',metric:'RUSHYDS',line:99.5}};
  assert.deepEqual(highestYardageNos([c(100,.96),c(120,.98),other]).map(x=>x.market.ticker),[other.market.ticker,c(120,.98).market.ticker]);
});
test('NO seller is a YES bid at the complementary price with real depth',()=>{
  const book={yes_dollars:[['0.0100','12.00'],['0.0300','5.00'],['0.0400','7.00']]};
  assert.deepEqual(bestNoAsk(book),{price:.96,size:7});
  assert.equal(noDepthAtAsk(book,.96,9),7);
  assert.equal(noDepthAtAsk(book,.97,9),9);
  assert.equal(bestNoAsk({no_dollars:[['0.98','20']]}),null);
});
test('external zero requires the exact Q3 fixture and at least one target or carry',async()=>{
  const board=structuredClone(fixture.espn);
  for(const event of board.events){event.status.period=3;event.status.displayClock='02:31';
    for(const c of event.competitions){c.status.period=3;c.status.displayClock='02:31';}}
  const summary=targets=>({boxscore:{players:[{statistics:[{name:'receiving',labels:['REC','YDS','TGTS'],
    athletes:[{athlete:{displayName:'Chig Okonkwo'},stats:['0','0',String(targets)]}]}]}]}});
  const run=(box,source=board)=>verifyIndependentYardageZero(game,fixture.milestone,
    {name:'Chig Okonkwo',metric:'RECYDS',value:0,line:99.5},{fetcher:async url=>({ok:true,json:async()=>url.includes('summary?')?box:source})});
  assert.equal(await run(summary(1)),true);
  assert.equal(await run(summary(0)),false);
  assert.equal(await run({boxscore:{players:[]}}),false);
  assert.equal(await run(summary(1),{events:[]}),false);
  const conflicting=structuredClone(board);conflicting.events[0].status.period=4;
  conflicting.events[0].competitions[0].status.period=4;
  let boards=0;
  assert.equal(await verifyIndependentYardageZero(game,fixture.milestone,
    {name:'Chig Okonkwo',metric:'RECYDS'},
    {fetcher:async url=>({ok:true,json:async()=>url.includes('summary?')?summary(1):++boards===1?board:conflicting})}),false);
});
test('a NO opening ask requires independent proof; reduce-only YES sales remain separate',()=>{
  const proof={id:'g',verificationId:'v'},m=market(100);
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',
    {ticker:m.ticker,side:'ask',reduce_only:false},[]),/independent external/);
  rememberIndependentEntry(proof,m,'v',Date.now());
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
    {ticker:m.ticker,side:'ask',reduce_only:false},[{game:proof,market:m}]));
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
    {ticker:m.ticker,side:'ask',reduce_only:true},[]));
});
test('NO settlement history uses actual NO fill cost and exchange revenue',()=>{
  const entry={strategy:'no',order_id:'order',market_ticker:'T',fill_count:5,created_at:'2026-11-03T00:00:00Z'};
  const fills=[{order_id:'order',ticker:'T',outcome_side:'no',count_fp:'5.00',no_price_dollars:'0.9800',fee_cost:'0.0100'}];
  assert.equal(completedNoTrade(entry,fills,{no_count_fp:'5.00',revenue:500,settled_time:'2026-11-03T03:00:00Z'}).profitCents,9);
  assert.equal(completedNoTrade(entry,fills,{no_count_fp:'5.00',revenue:0,settled_time:'2026-11-03T03:00:00Z'}).profitCents,-491);
});

test('scan preserves the first verification and sends a bounded NO order after a second check',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const section=source.slice(source.indexOf('async function scanThirdQuarterNos('),source.indexOf('async function scan('));
  const m={...market(100),event_ticker:'KXNFLRECYDS-GAME'};
  const events=new Map([[m.event_ticker,{category:'Sports',event_ticker:m.event_ticker,markets:[m]}]]);
  const games=[{milestone:fixture.milestone,state:game}];
  let first=null,verification=0,order=null,attempt=null;
  const positions={market_positions:[]},account={balance:10000,portfolio_value:0};
  const pool={query:async(sql,args=[])=>{
    if(sql.includes('FROM no_verification_windows'))return {rows:first?[first]:[],rowCount:first?1:0};
    if(sql.includes('INSERT INTO no_verification_windows')){first={market_ticker:m.ticker,contract:m,first_at:new Date(Date.now()-21000),game_id:game.id};return {rows:[],rowCount:1}}
    if(sql.includes('FROM trade_attempts')&&sql.includes("strategy='no'"))return {rows:[],rowCount:0};
    if(sql.includes('FROM trade_attempts')&&sql.includes('market_ticker=$1'))return {rows:[],rowCount:0};
    if(sql.includes('UPDATE trade_attempts')){attempt=args;return {rows:[],rowCount:1}}
    return {rows:[],rowCount:0};
  }};
  const context=vm.createContext({console,Date,Number,Math,JSON,Set,Map,Promise,pool,live:()=>true,
    linkedEventTickers:()=>[m.event_ticker],thirdQuarterYardageNo,highestYardageNos,bestNoAsk,noDepthAtAsk,
    mapBatches:async(items,_,fn)=>Promise.all(items.map(fn)),
    kalshi:async(path,options)=>options?.method==='POST'?(order=options,{fill_count_fp:'2.00',order_id:'ord'}):
      path.endsWith('/orderbook')?{orderbook_fp:{yes_dollars:[['0.0200','2.00']]}}:{market:m},
    minimumCount:()=>.01,sameSportsContract:()=>true,allOpenPositions:async()=>positions,
    verifyIndependentYardageZero:async()=>{verification++;return true},
    liveMilestone:async()=>({}),gameState:()=>({...game,observedAt:Date.now()}),
    accountBalance:async()=>account,shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:x=>x,
    feeReserve:()=>2,orderSize,estimatedCostCents,profitableCount:n=>n,
    auditTable:async()=>{},randomUUID:()=> 'id',rememberIndependentEntry:()=>{},
    reserve:async()=> 'id',withEntryProfitFloor:async(_,send)=>send(),invalidateBalance:async()=>{}});
  vm.runInContext(section,context);
  assert.equal(await context.scanThirdQuarterNos(games,events),0);
  assert.equal(verification,1);assert.equal(order,null);
  assert.equal(await context.scanThirdQuarterNos(games,events),1);
  assert.equal(verification,2);
  assert.equal(order.body.side,'ask');assert.equal(order.body.reduce_only,false);
  assert.equal(order.body.price,'0.0200');assert.equal(order.body.time_in_force,'fill_or_kill');
  assert.equal(attempt[1],'filled');assert.ok(estimatedCostCents(Number(order.body.count),.98)<=3000);
});
