import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ensureExitLedger,recordExitFill} from '../src/exit_ledger.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const reconcile=source.slice(source.indexOf('async function reconcilePendingExit('),source.indexOf('async function exitComebacks('));
test('exit ledger backfills an existing sale before the mutable row can be reused',async()=>{
  const calls=[];await ensureExitLedger(async(sql,args)=>{calls.push({sql,args})});
  assert.equal(calls.length,2);
  assert.match(calls[1].sql,/FROM exit_attempts WHERE order_id IS NOT NULL AND filled_count>0/);
  await recordExitFill(async(sql,args)=>{calls.push({sql,args})},'M','exit-2',6);
  assert.deepEqual(calls[2].args,['exit-2','M',6]);
  await assert.rejects(recordExitFill(async()=>{},'M',null,4),/missing its Kalshi order ID/);
});
test('an uncertain exit archives the exact recovered order without requiring a held position or sale quote',async()=>{
  const writes=[],order={order_id:'sale-4',status:'canceled',fill_count_fp:'4.00'};
  const pool={query:async(sql,args)=>{writes.push([sql,args]);return sql.startsWith('SELECT * FROM exit_attempts')?
    {rows:[{id:'request-4',status:'uncertain',created_at:'2026-11-01T10:00:00Z'}]}:{rows:[]}}};
  const ctx=vm.createContext({pool,lookupSubmittedOrder:async()=>order,resolvedManualOrder:o=>({filled:Number(o.fill_count_fp)}),
    recordExitFill, invalidateBalance:async()=>{},console,Date,Number});
  vm.runInContext(reconcile,ctx);
  assert.equal(await ctx.reconcilePendingExit('M'),true);
  assert.ok(writes.some(([sql,args])=>sql.includes('INSERT INTO exit_fill_ledger')&&args[0]==='sale-4'));
  assert.ok(writes.some(([sql,args])=>sql.includes('UPDATE exit_attempts SET status=')&&args[1]==='filled'));
});
