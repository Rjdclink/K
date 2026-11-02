import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {scannerControl,withScannerOwner,assertScannerAuthority} from '../src/scanner_runtime.mjs';

function harness(control={owner:'neon',worker_id:null}){
  let locked=false;const calls=[],clients=[];
  const pool={connect:async()=>{
    const client=new EventEmitter();clients.push(client);
    client.query=async(sql,args)=>{
      calls.push(sql);
      if(sql.startsWith('SELECT owner'))return {rows:[control]};
      if(sql.includes('pg_try_advisory_lock')){const acquired=!locked;if(acquired)locked=true;return {rows:[{acquired}]}}
      if(sql.includes('pg_advisory_unlock')){locked=false;return {rows:[{}]}}
      throw Error('Unexpected query');
    };
    client.release=broken=>{client.released=broken?'destroyed':'returned';if(broken)locked=false};
    return client;
  }};
  return {pool,calls,clients,setControl:value=>{control=value}};
}
test('only the assigned runtime runs; a standby worker never steals the Neon lock',async()=>{
  const h=harness();let ran=0;
  assert.ok((await withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>ran++)).skipped);
  assert.equal(h.calls.some(sql=>sql.includes('pg_try_advisory_lock')),false);
  assert.equal(await withScannerOwner(h.pool,{owner:'neon'},async()=>{await assertScannerAuthority({write:true});return ++ran}),1);
  h.setControl({owner:'worker',worker_id:'remote-1'});
  assert.ok((await withScannerOwner(h.pool,{owner:'neon'},()=>ran++)).skipped);
  assert.ok((await withScannerOwner(h.pool,{owner:'worker',id:'remote-2'},()=>ran++)).skipped);
  assert.equal(await withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>++ran),2);
});
test('two replicas cannot scan together and the lock is released after errors',async()=>{
  const h=harness({owner:'worker',worker_id:'remote-1'});let release;
  const first=withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>new Promise(resolve=>{release=resolve}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok((await withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>assert.fail('duplicate scan'))).skipped);
  release('done');assert.equal(await first,'done');
  await assert.rejects(withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>{throw Error('window failed')}),/window failed/);
  assert.equal(await withScannerOwner(h.pool,{owner:'worker',id:'remote-1'},()=>42),42);
});
test('lost ownership or shutdown blocks exchange writes from the old runtime',async()=>{
  for(const mode of ['connection','control','shutdown']){
    const h=harness(),controller=new AbortController();
    await withScannerOwner(h.pool,{owner:'neon',signal:controller.signal},async()=>{
      await assertScannerAuthority({write:true});
      if(mode==='connection')h.clients[0].emit('error',Error('disconnected'));
      if(mode==='control')h.setControl({owner:'worker',worker_id:'remote-1'});
      if(mode==='shutdown')controller.abort();
      await assert.rejects(assertScannerAuthority({write:true}),{code:'SCANNER_OWNERSHIP_LOST'});
    });
    assert.equal(h.clients[0].released,mode==='connection'?'destroyed':'returned');
  }
});
test('missing optional schema keeps legacy Neon working and denies remote ownership',async()=>{
  const missing={query:async()=>{throw Object.assign(Error('missing table'),{code:'42P01'})}};
  assert.deepEqual(await scannerControl(missing),{owner:'neon',worker_id:null});
  await assertScannerAuthority({write:true}); // Interactive calls have independent existing admission gates.
});
