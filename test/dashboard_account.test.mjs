import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {apiPriority,withApiPriority} from '../src/api_priority.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const accountSource=source.slice(source.indexOf('let balanceSchemaReady;'),source.indexOf('let auditReady;'));
function accountHarness(value){
 const writes=[];
 const client={query:async(sql,args)=>{writes.push(sql);if(sql.startsWith('SELECT balance_json'))return {rows:[{balance_json:{balance:100,portfolio_value:200},updated_at:new Date(0),last_request_at:new Date(0),invalidated_at:new Date()}]};return {rows:[]}},release(){}};
 const context=vm.createContext({apiPriority:()=> 'interactive',pool:{connect:async()=>client,query:client.query},
  balanceQueue:new Promise(()=>{}),Date,Number,Promise,AbortController,setTimeout,clearTimeout,
  kalshi:async()=>value});vm.runInContext(accountSource,context);
 return {context,writes};
}
test('dashboard balance bypasses the local scanner queue and keeps cash and portfolio in cents',async()=>{
 const h=accountHarness({balance:3277,balance_dollars:'32.7713',portfolio_value:1734});
 const result=await h.context.accountBalance();
 assert.equal(result.balance+result.portfolio_value,5011);
 assert.ok(result.as_of);assert.ok(h.writes.some(q=>q.includes('invalidated_at=NULL')));
 await h.context.invalidateBalance();
 assert.ok(h.writes.at(-1).includes('invalidated_at=clock_timestamp()'));
 assert.equal(h.writes.some(q=>q.includes('updated_at=to_timestamp(0)')),false,'invalidate trading freshness without destroying the last verified snapshot timestamp');
});
test('an incomplete exchange response never overwrites a valid bankroll snapshot',async()=>{
 const h=accountHarness({balance:123});await assert.rejects(h.context.accountBalance(),/incomplete balance/);
 assert.equal(h.writes.some(q=>q.startsWith('UPDATE account_cache SET balance_json')),false);
});
test('state, quotes and explicit sell requests receive interactive priority; scans remain normal',async()=>{
 const context=vm.createContext({withApiPriority,URL,fillComboQueue:{run:f=>f()},handleRequest:async()=>apiPriority()});
 vm.runInContext('handler='+source.slice(source.indexOf('export default ')+15).replace(/;\s*$/,''),context);
 for(const path of ['/api/state','/api/sell-quotes?ticker=X','/api/sell'])assert.equal(await context.handler.fetch({url:'https://k.test'+path}),'interactive');
 assert.equal(await context.handler.fetch({url:'https://k.test/tick'}),'normal');
});
