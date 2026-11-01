import test from 'node:test';
import assert from 'node:assert/strict';
import {createPriorityGate,withApiPriority,apiPriority} from '../src/api_priority.mjs';

test('live checks overtake queued catalog requests without prebooking future slots',async()=>{
  let release,blocked=true;const admitted=[],delays=[];
  const gate=createPriorityGate(async priority=>{
    if(blocked)return 60000;
    admitted.push(priority);return 0;
  },{wait:ms=>{delays.push(ms);return new Promise(resolve=>{release=resolve})}});
  const background=gate('background'),normal=gate('normal');
  await new Promise(r=>setImmediate(r));
  const live=gate('live');blocked=false;release();
  await Promise.all([background,normal,live]);
  assert.deepEqual(admitted,['live','normal','background']);
  assert.deepEqual(delays,[250],'long shared backoff remains interruptible by new live work');
});
test('priority contexts survive asynchronous work without leaking into concurrent weather requests',async()=>{
  const seen=await Promise.all(['live','background'].map(priority=>withApiPriority(priority,async()=>{
    await new Promise(r=>setImmediate(r));return apiPriority();
  })));
  assert.deepEqual(seen,['live','background']);assert.equal(apiPriority(),'normal');
});
test('a failed admission rejects only that request and the queue recovers',async()=>{
  let calls=0;const gate=createPriorityGate(async()=>{if(!calls++)throw Error('database unavailable');return 0});
  const first=gate(),second=gate('live');
  await assert.rejects(first,/database unavailable/);await second;await gate();
  assert.equal(calls,3);
});

test('interactive dashboard work overtakes live scanners while preserving the common rate limit',async()=>{
 let release,blocked=true;const admitted=[];
 const gate=createPriorityGate(async priority=>{if(blocked)return 250;admitted.push(priority);return 0},
  {wait:()=>new Promise(resolve=>{release=resolve})});
 const live=gate('live'),normal=gate('normal');await new Promise(r=>setImmediate(r));
 const interactive=gate('interactive');blocked=false;release();await Promise.all([interactive,live,normal]);
 assert.deepEqual(admitted,['interactive','live','normal']);
});

test('continuous urgent traffic cannot starve catalog and reconciliation requests',async()=>{
 let release,blocked=true;const admitted=[];
 const gate=createPriorityGate(async priority=>{if(blocked)return 250;admitted.push(priority);return 0},
  {wait:()=>new Promise(resolve=>{release=resolve})});
 const jobs=[gate('background'),gate('normal'),...Array.from({length:10},()=>gate('live'))];
 await new Promise(r=>setImmediate(r));blocked=false;release();await Promise.all(jobs);
 assert.equal(admitted.indexOf('background'),4);
 assert.equal(admitted.indexOf('normal'),9);
 assert.equal(admitted.length,12);
});
