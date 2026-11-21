import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mapBatches} from '../src/discovery.mjs';
import {rankNoncushionedReplacements,FIRST_NONCUSHIONED_CHECK_MS} from '../src/noncushioned_player_over.mjs';
import {netSettlementProfitCents,estimatedCostCents} from '../src/strategy.mjs';

test('with one freed slot the executable prop with highest TOTAL NET PROFIT is offered first, not earliest candidate',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function scanNoncushionedPlayerOvers(');
 const end=source.indexOf('async function scanVariablePlayerOvers(',start);
 assert.ok(start>=0&&end>start,'standalone scanner must exist');
 const tickers=['earliest','most-profitable','middle'];
 const prices=[.75,.50,.65];
 const markets=tickers.map((name,i)=>({
  ticker:name,event_ticker:'EVENT',status:'active',yes_ask_dollars:String(prices[i]),
  yes_ask_size_fp:'20',floor_strike:6.5,strike_type:'greater',title:'Pat: 7+ rebounds',
  yes_sub_title:'Pat: 7+',custom_strike:{basketball_player:'p'}
 }));
 const now=Date.now(),game={id:'game',type:'basketball_game',sport:'NBA',verifiedLive:true,
  home:40,away:40,period:1,remainingSeconds:600,observedAt:now,
  playerStats:{p:{rebounds:7}},verificationId:null};
 const captured=[],attempts=[];
 const context=vm.createContext({
  live:()=>true,Date,JSON,Number,Math,Promise,console,Map,Set,
  playerPropEarlyWindow:()=>true,linkedEventTickers:()=>['EVENT'],
  uncushionedPlayerSpec:(g,m)=>({key:'key-'+m.ticker,player:{id:'p',name:'Pat',metric:'REB',line:6.5}}),
  overCushion:()=>null,FIRST_NONCUSHIONED_CHECK_MS,
  mapBatches,hasAsk:()=>true,rankNoncushionedReplacements,
  pool:{query:async(sql,args=[])=>{
   if(sql.startsWith('CREATE TABLE'))return {rows:[]};
   if(sql.includes('INSERT INTO noncushioned_prop_preflights'))return {rows:JSON.parse(args[0]).map(item=>({
    market_ticker:item.market_ticker,first_seen:new Date(now-220000),
    first_proof:{source:'ESPN',eventId:'fixed-game',gameId:'game',contractKey:item.contract_key,
     playerId:'p',metric:'REB',playerValue:7,requestedAt:now-220000}}))};
   if(sql.includes('SELECT 1 FROM trade_attempts'))return {rows:[]};
   if(sql.startsWith('INSERT INTO verification_records'))return {rows:[]};
   throw Error('unexpected query '+sql.slice(0,90));
  }},
  accountBalance:async()=>({balance:10000,portfolio_value:0}),
  singleSpendableCash:n=>n,marketShard:()=>0,shardCash:()=>10000,
  kalshi:async path=>({market:markets.find(m=>path.endsWith('/'+m.ticker))}),
  sameSportsContract:()=>true,
  recoverSummaryAsk:async market=>market,
  executableQuote:async market=>market,
  feeReserve:()=>2,contractCount:()=>10,
  netSettlementProfitCents,estimatedCostCents,
  liveMilestone:async()=>({}),
  gameState:()=>({...game,observedAt:Date.now()}),
  externallyScoredGame:async()=>({...game,observedAt:Date.now(),
   externalScore:{source:'ESPN',eventId:'fixed-game',checkedAt:Date.now(),gameId:'game',live:true}}),
  verifiedSourceReady:()=>true,
  verifyNoncushionedPlayerStat:async(g,m,market)=>({
   source:'ESPN',eventId:'fixed-game',gameId:'game',
   contractKey:'key-'+market.ticker,playerId:'p',metric:'REB',playerValue:8,
   requestedAt:Date.now()}),
  noncushionedTwoProofs:()=>true,noncushionedPlayerState:g=>({...g}),
  auditTable:async()=>{},randomUUID:()=> 'proof',rememberIndependentEntry:(g,m,id)=>{g.independentEntry={id}},
  timedOverEntryValid:()=>true,NONCUSHIONED_PLAYER_TAG:'Non-cushioned player prop',
  submit:async(signal,checked,event,market)=>{
   attempts.push(market.ticker);
   if(captured.length)return false;captured.push(market.ticker);return true;
  }
 });
 vm.runInContext(source.slice(start,end),context);
 const result=await context.scanNoncushionedPlayerOvers([{milestone:{id:'game'},state:game}],
  new Map([['EVENT',{category:'Sports',markets}]]),new Map());
 assert.equal(result,1);
 assert.equal(captured[0],'most-profitable','best available net-dollar contract must receive the first freed slot');
 assert.equal(attempts[0],'most-profitable');
});
test('the live buy lock checks unsettled noncushioned position slots and confirmed exchange settlements',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const gate=source.slice(source.indexOf('async function withEntryProfitFloor('),source.indexOf('async function ensureStaleReviewTable()'));
 assert.match(gate,/pg_try_advisory_xact_lock/);
 assert.match(gate,/account_history_settlements/);
 assert.match(gate,/openNoncushionedPlayerTickers/);
 assert.match(gate,/open\.size>5/);
});
