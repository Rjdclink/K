import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const segment=source.slice(source.indexOf('async function lookupSubmittedOrder('),source.indexOf('async function syncTradeHistory('));
const id='00000000-0000-0000-0000-000000000001';
const created_at='2026-11-01T12:00:00Z';
const context=bindings=>vm.createContext({Date,Number,String,JSON,URLSearchParams,Error,Promise,...bindings});
test('manual order reconciliation searches every order page for its client ID',async()=>{
  const seen=[],ctx=context({kalshi:async path=>{seen.push(path);return seen.length===1?
    {orders:[],cursor:'next'}:{orders:[{client_order_id:id,order_id:'exchange-1'}],cursor:''}}});
  vm.runInContext(segment,ctx);
  assert.equal((await ctx.lookupSubmittedOrder('M',id,created_at)).order_id,'exchange-1');
  assert.equal(new URL(seen[1],'https://test.invalid').searchParams.get('cursor'),'next');
});
test('definitive Kalshi sale rejection releases the pending sale without a second order',async()=>{
  const writes=[],client={query:async sql=>sql.startsWith('SELECT * FROM manual_sales')?{rows:[]}:{rows:[]},release:()=>{}};
  const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rows:[]}},connect:async()=>client};
  const ctx=context({pool,ensureManualSales:async()=>{},currentSell:async()=>({price:.55,count:1}),kalshi:async()=>{throw Error('Kalshi 400 POST /portfolio/events/orders: invalid')},
    invalidateBalance:async()=>{},json:(body,status)=>({body,status})});
  vm.runInContext(segment,ctx);
  const reply=await ctx.manualSell({ticker:'M',id,price:.50});
  assert.equal(reply.status,409);
  assert.ok(writes.some(([sql])=>sql.includes("UPDATE manual_sales SET status='unfilled'")));
});
test('an uncertain combo add-on recovers its actual fill on the next request',async()=>{
  const writes=[],old={id,ticker:'M',status:'pending',created_at};
  const client={query:async(sql,args)=>{writes.push([sql,args]);return sql.startsWith('SELECT * FROM manual_combo_buys')?{rows:[old],rowCount:1}:{rows:[]}},release:()=>{}};
  const pool={connect:async()=>client};
  const ctx=context({pool,live:()=>true,ensureManualCombos:async()=>{},invalidateBalance:async()=>{},
    kalshi:async()=>({orders:[{client_order_id:id,order_id:'exchange-buy',status:'executed',fill_count_fp:'2.00'}],cursor:''}),
    json:(body,status=200)=>({body,status})});
  vm.runInContext(segment,ctx);
  const reply=await ctx.manualBuyCombo({ticker:'M',id,amount_cents:100,price:.50});
  assert.equal(reply.body.filled,2);
  assert.ok(writes.some(([sql,args])=>sql.includes('UPDATE manual_combo_buys')&&args[1]==='complete'));
});
test('the normal reconciliation pass resolves a pending combo buy without another button press',async()=>{
  const writes=[],requests=[];
  const pool={query:async(sql,args)=>{writes.push([sql,args]);return sql.includes('FROM manual_sales WHERE status=')?{rows:[]}:
    sql.startsWith('SELECT id,ticker,created_at')?{rows:[{id,ticker:'M',created_at}]}:{rows:[],rowCount:1}}};
  const ctx=context({pool,ensureManualCombos:async()=>{},ensureManualSales:async()=>{},invalidateBalance:async()=>{},
    kalshi:async path=>{requests.push(path);return {orders:[{client_order_id:id,order_id:'exchange-buy',status:'executed',fill_count_fp:'2'}],cursor:''}},
    console:{warn:()=>{}}});
  vm.runInContext(segment,ctx);
  await ctx.reconcilePendingManualOrders();
  assert.equal(requests.length,1);
  assert.ok(writes.some(([sql,args])=>sql.startsWith('UPDATE manual_combo_buys')&&args[1]==='complete'));
});
test('manual combo purchase honors the shared final profit gate before dispatch',async()=>{
  const writes=[],sent=[];
  const client={query:async sql=>sql.startsWith('SELECT * FROM manual_combo_buys')?{rows:[],rowCount:0}:
    sql.startsWith('SELECT combo_legs,strategy')?{rows:[{combo_legs:[{market_ticker:'LEG'}],strategy:'lead'}]}:{rows:[]},release:()=>{}};
  const pool={connect:async()=>client,query:async(sql,args)=>{writes.push([sql,args]);return {rows:[]}}};
  const ctx=context({pool,live:()=>true,ensureManualCombos:async()=>{},
    allOpenPositions:async()=>({market_positions:[{ticker:'LEG',position_fp:'1'},{ticker:'M',position_fp:'1'}]}),
    accountBalance:async()=>({balance:1000,portfolio_value:1000}),marketShard:()=>0,shardCash:()=>1000,
    manualComboQuote:()=>({count:1,price:.99}),comboHeldFraction:()=>.10,
    withEntryProfitFloor:async()=>null,kalshi:async path=>{sent.push(path);return path.endsWith('/orderbook')?{orderbook_fp:{}}:{market:{ticker:'M'}}},
    json:(body,status=200)=>({body,status})});
  vm.runInContext(segment,ctx);
  const reply=await ctx.manualBuyCombo({ticker:'M',id,amount_cents:100,price:.99});
  assert.equal(reply.status,409);
  assert.equal(sent.filter(p=>p==='/portfolio/events/orders').length,0);
  assert.ok(writes.some(([sql])=>sql.includes("UPDATE manual_combo_buys SET status='unfilled'")));
});
