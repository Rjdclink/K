import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates} from '../src/history.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('history reconciliation recovers a recorded automatic exit loss from actual canonical NO fills',async()=>{
 const entry={id:'local-id',market_ticker:'M',sport:'NBA',teams:'Away at Home',order_id:'entry',fill_count:10,expected_sold:10,created_at:'2026-11-01T12:00:00Z'};
 const fills=[{ticker:'M',order_id:'entry',outcome_side:'yes',action:'buy',count_fp:'10',yes_price_dollars:'.80',fee_cost:'.10',created_time:'2026-11-01T12:00:01Z'},
  {ticker:'M',order_id:'exit',outcome_side:'no',side:'no',action:'buy',count_fp:'10',yes_price_dollars:'.55',fee_cost:'.05',created_time:'2026-11-01T12:04:00Z'}];
 const inserted=[];
 const context=vm.createContext({console,Date,Math,Number,Map,Set,JSON,URLSearchParams,completedTrade,manualSaleFill,reconcileManualSaleFills,settlementLookupCandidates,upgradeTables:async()=>{},
  pool:{query:async(sql,args)=>{
   if(sql.includes('SELECT started_at'))return {rows:[{started_at:entry.created_at}]};
   if(sql.includes('SELECT a.id,a.market_ticker'))return {rows:[entry]};
   if(sql.includes('to_regclass'))return {rows:[{name:null}]};
   if(sql.startsWith('SELECT market_ticker,order_id FROM exit_attempts'))return {rows:[{market_ticker:'M',order_id:'exit'}]};
   if(sql.startsWith('INSERT INTO trade_history'))inserted.push(args);
   return {rows:[],rowCount:0};
  }},kalshi:async path=>{assert.ok(path.startsWith('/portfolio/fills?'));return {fills,cursor:''}}});
 vm.runInContext(source.slice(source.indexOf('async function syncTradeHistory('),source.indexOf('async function syncSettlementAlerts(')),context);
 await context.syncTradeHistory([{ticker:'M',market_result:'yes',settled_time:'2026-11-01T13:00:00Z'}]);
 assert.equal(inserted.length,1);assert.equal(inserted[0][5],-265,'sold shares receive no later settlement payout');
});
