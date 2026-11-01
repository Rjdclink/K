import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates} from '../src/history.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('history reconciliation accounts for two partial exit orders when recording a loss',async()=>{
 const entry={id:'local-id',market_ticker:'M',sport:'NBA',teams:'Away at Home',order_id:'entry',fill_count:10,expected_sold:10,created_at:'2026-11-01T12:00:00Z'};
 const fills=[{ticker:'M',order_id:'entry',outcome_side:'yes',action:'buy',count_fp:'10',yes_price_dollars:'.80',fee_cost:'.10',created_time:'2026-11-01T12:00:01Z'},
  {ticker:'M',order_id:'exit-1',outcome_side:'no',side:'no',action:'buy',count_fp:'4',yes_price_dollars:'.55',fee_cost:'.02',created_time:'2026-11-01T12:04:00Z'},
  {ticker:'M',order_id:'exit-2',outcome_side:'no',side:'no',action:'buy',count_fp:'6',yes_price_dollars:'.55',fee_cost:'.03',created_time:'2026-11-01T12:05:00Z'}];
 const inserted=[];
 const context=vm.createContext({console,Date,Math,Number,Map,Set,JSON,URLSearchParams,completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates,upgradeTables:async()=>{},ensureExitFills:async()=>{},ensureManualCombos:async()=>{},ensureManualSales:async()=>{},
  pool:{query:async(sql,args)=>{
   if(sql.includes('SELECT started_at'))return {rows:[{started_at:entry.created_at}]};
   if(sql.includes('SELECT a.id,a.market_ticker'))return {rows:[entry]};
   if(sql.includes('to_regclass'))return {rows:[{name:null}]};
   if(sql.startsWith('SELECT market_ticker,order_id FROM exit_fill_ledger'))return {rows:[{market_ticker:'M',order_id:'exit-1'},{market_ticker:'M',order_id:'exit-2'}]};
   if(sql.startsWith('INSERT INTO trade_history'))inserted.push(args);
   return {rows:[],rowCount:0};
  }},kalshi:async path=>{assert.ok(path.startsWith('/portfolio/fills?'));return {fills,cursor:''}}});
 vm.runInContext(source.slice(source.indexOf('async function syncTradeHistory('),source.indexOf('async function syncSettlementAlerts(')),context);
 await context.syncTradeHistory([{ticker:'M',market_result:'yes',settled_time:'2026-11-01T13:00:00Z'}]);
 assert.equal(inserted.length,1);assert.equal(inserted[0][5],-265,'sold shares receive no later settlement payout');
});

test('unfinished live trades do not pin a fifty-row batch ahead of an older closed loss',async()=>{
 const now=Date.now(),at=new Date(now-3600000).toISOString(),attempts=new Map(),inserted=[];let cycle=0;
 const rows=Array.from({length:51},(_,i)=>({id:'id-'+i,market_ticker:'M'+i,sport:'NBA',teams:'Away at Home',order_id:'buy-'+i,fill_count:10,
  created_at:new Date(now-3600000-i*1000).toISOString(),game_status:'live',expected_sold:i===50?10:null}));
 const context=vm.createContext({console,Date,Math,Number,Map,Set,JSON,URLSearchParams,completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates,upgradeTables:async()=>{},ensureExitFills:async()=>{},ensureManualCombos:async()=>{},ensureManualSales:async()=>{},
  pool:{query:async(sql,args)=>{
   if(sql.includes('SELECT started_at'))return {rows:[{started_at:new Date(now-86400000).toISOString()}]};
   if(sql.includes('SELECT a.id,a.market_ticker'))return {rows:[...rows].sort((a,b)=>(attempts.get(a.id)||0)-(attempts.get(b.id)||0)||Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,50)};
   if(sql.startsWith('INSERT INTO history_reconciliation_work')){cycle++;for(const id of args[0])attempts.set(id,cycle)}
   if(sql.includes('to_regclass'))return {rows:[{name:null}]};
   if(sql.startsWith('SELECT market_ticker,order_id FROM exit_fill_ledger'))return {rows:[{market_ticker:'M50',order_id:'sell-50'}]};
   if(sql.startsWith('INSERT INTO trade_history'))inserted.push(args);
   return {rows:[],rowCount:0};
  }},kalshi:async path=>{
   const ticker=new URL(path,'https://k.test').searchParams.get('ticker');
   return {fills:ticker==='M50'?[{ticker,order_id:'buy-50',outcome_side:'yes',action:'buy',count_fp:'10',yes_price_dollars:'.8',fee_cost:'.1',created_time:at},
    {ticker,order_id:'sell-50',outcome_side:'no',action:'buy',count_fp:'10',yes_price_dollars:'.55',fee_cost:'.05',created_time:new Date(now-60000).toISOString()}]:[],cursor:''};
  }});
 vm.runInContext(source.slice(source.indexOf('async function syncTradeHistory('),source.indexOf('async function syncSettlementAlerts(')),context);
 await context.syncTradeHistory([]);assert.equal(inserted.length,0);
 await context.syncTradeHistory([]);assert.equal(inserted.length,1);assert.equal(inserted[0][0],'id-50');assert.equal(inserted[0][5],-265);
});
