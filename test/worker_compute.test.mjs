import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerCompute} from '../src/worker_compute.mjs';
import {probeKalshi} from '../workers/probe.mjs';
import {assessWorker} from '../workers/readiness.mjs';
import {benchmarkWorkerRuntime} from '../src/worker_benchmark.mjs';

test('light work stays ordered while heavy tasks execute singly, with priority and deadline admission',async()=>{
  const compute=new WorkerCompute(),seen=[];let release;
  const first=compute.beam(()=>new Promise(resolve=>{release=()=>{seen.push('first');resolve()}}));
  const normal=compute.beam(()=>seen.push('normal'));
  const urgent=compute.beam(()=>seen.push('urgent'),{priority:100});
  const expired=compute.beam(()=>assert.fail('expired task ran'),{deadlineAt:Date.now()-1});
  const expiredCheck=assert.rejects(expired,/expired/);
  compute.antenna(()=>seen.push('light'));release();
  await Promise.all([first,normal,urgent,expiredCheck]);
  assert.deepEqual(seen,['light','first','urgent','normal']);
  assert.equal(compute.status().measured.beam.calls,3);
});
test('stopping a worker cancels queued work without starting a second heavy task',async()=>{
  const compute=new WorkerCompute();let release;
  const first=compute.beam(()=>new Promise(resolve=>{release=resolve}));
  const next=compute.beam(()=>assert.fail('stopped task ran'));
  const check=assert.rejects(next,/cancelled/);compute.stop();release();
  await Promise.all([first,check]);
  await assert.rejects(compute.beam(()=>{}),/stopped/);
});
test('probes are spaced, public GET reads and reject invalid/error responses',async()=>{
  let clock=0,requests=0;const waits=[];
  const result=await probeKalshi({samples:3,clock:()=>clock,wait:async ms=>waits.push(ms),fetcher:async(url,opts)=>{
    assert.equal(new URL(url).pathname,'/trade-api/v2/exchange/status');
    assert.equal(opts.method,undefined);assert.equal(opts.headers.authorization,undefined);
    clock+=++requests*10;
    return {ok:true,json:async()=>({exchange_active:true,trading_active:true})};
  }});
  assert.equal(result.medianMs,20);assert.equal(result.p95Ms,30);assert.deepEqual(waits,[1250,1250]);
  await assert.rejects(probeKalshi({samples:3,fetcher:async()=>({ok:false,status:429})}),/429/);
  await assert.rejects(probeKalshi({samples:3,fetcher:async()=>({ok:true,json:async()=>({})})}),/Unexpected/);
});
test('handoff readiness requires measured timings and lower TOTAL operating cost',()=>{
  const baseline={at:new Date().toISOString(),projectionPeriodHours:720,totalOperatingUsd:20,samples:7,exchangeP95Ms:100,databaseP95Ms:20,criticalPathP95Ms:400,measured:true};
  const candidate={...baseline,totalOperatingUsd:15,exchangeP95Ms:60,criticalPathP95Ms:250};
  assert.equal(assessWorker({baseline,candidate}).ready,true);
  for(const change of [{totalOperatingUsd:21},{exchangeP95Ms:110},{criticalPathP95Ms:450},{measured:false},{samples:0},{projectionPeriodHours:24},{at:'2020-01-01'}])
    assert.equal(assessWorker({baseline,candidate:{...candidate,...change}}).ready,false);
  assert.equal(assessWorker().ready,false);
});
test('a runtime benchmark uses only fixed exchange GETs and database reads',async()=>{
  let time=0,gets=0,queries=0;
  const result=await benchmarkWorkerRuntime({clock:()=>time,query:async sql=>{
    assert.equal(sql,'SELECT 1');queries++;time+=5;
  },get:async(path,opts)=>{
    assert.ok(['/exchange/status','/portfolio/balance','/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=1'].includes(path));
    assert.equal(opts.method,undefined);gets++;time+=20;
  }});
  assert.equal(result.measured,true);assert.equal(result.criticalPathP95Ms,75);
  assert.equal(result.exchangeP95Ms,20);assert.equal(result.databaseP95Ms,5);
  assert.equal(gets,21);assert.equal(queries,21);
});
