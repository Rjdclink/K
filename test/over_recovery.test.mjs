import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {singleSpendableCash} from '../src/combos.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('local proof expiry preserves the recovery client ID and permits one later verified retry',async()=>{
 const row={id:'same-client-id',market_ticker:'OVER',count:2,limit_price:.95,retries:0,status:'check_order',created_at:new Date(Date.now()-60000),updated_at:new Date(Date.now()-30000)};
 let valid=true,expire=true;const sent=[];
 const context=vm.createContext({console,Date,Number,Math,URLSearchParams,singleSpendableCash,
  timedOverEntryValid:()=>valid,assertTimedOverEntry:()=>{if(!valid)throw Object.assign(Error('expired locally'),{code:'LOCAL_OVER_PROOF_EXPIRED'})},
  reviewMiss:async()=>{if(expire)valid=false;return {retry:true,reason:'verified recovery'}},contractCount:()=>10,profitableCount:n=>n,feeReserve:()=>2,estimatedCostCents:()=>200,minimumThreeGoalSpend:()=>0,soccerWinnerWindowOpen:()=>true,
  confirmedSingleFill:async()=>{},withEntryProfitFloor:async(_,send)=>send(),
  pool:{query:async(sql,args)=>{
   if(sql.startsWith('SELECT * FROM trade_attempts'))return {rows:[row]};
   if(sql.includes("SET retries=1,status='retrying'")){row.retries=1;row.status='retrying';return {rows:[{id:row.id}],rowCount:1}}
   if(sql.includes("SET status='check_order',retries=0")){row.retries=0;row.status='check_order'}
   return {rows:[],rowCount:0};
  }},kalshi:async(path,opts={})=>{
   if(path.startsWith('/portfolio/orders?'))return {orders:[]};
   opts.beforeDispatch();sent.push(opts.body.client_order_id);return {fill_count_fp:'2',order_id:'exchange-order'};
  }});
 vm.runInContext(source.slice(source.indexOf('async function recoverPending('),source.indexOf('async function reconcileUpgrade(')),context);
 const run=()=>context.recoverPending({strategy:'over',fraction:.1},{id:'game'},{event_ticker:'E'},{ticker:'OVER',yes_ask_dollars:'.95'},10000,10000);
 assert.equal(await run(),false);assert.equal(row.retries,0);assert.equal(sent.length,0);
 valid=true;expire=false;assert.equal(await run(),true);assert.deepEqual(sent,['same-client-id']);
});
