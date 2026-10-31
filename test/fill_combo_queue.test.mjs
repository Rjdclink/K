import test from 'node:test';
import assert from 'node:assert/strict';
import {createFillComboQueue} from '../src/fill_combo_queue.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};

test('a fill starts checking immediately without blocking live work, and the request awaits completion',async()=>{
  const done=deferred(),events=[];
  const queue=createFillComboQueue(async fill=>{events.push('check:'+fill.id);await done.promise;events.push('complete')});
  let returned=false;
  const request=queue.run(async()=>{queue.enqueue({id:'fill'});await turn();events.push('live work');return 'response'}).then(result=>{returned=true;return result});
  await turn();assert.deepEqual(events,['check:fill','live work']);assert.equal(returned,false);
  done.resolve();assert.equal(await request,'response');assert.equal(returned,true);
});
test('a newer fill supersedes an old RFQ wait and starts a fresh serialized check',async()=>{
  const release=deferred(),calls=[];let superseded;
  const queue=createFillComboQueue(async(fill,options)=>{
    calls.push(fill?.id||'retry');
    if(!fill){superseded=options.superseded;await release.promise;assert.equal(superseded(),true)}
  });
  await queue.run(async()=>{
    queue.enqueue();await turn();assert.equal(superseded(),false);
    queue.enqueue({id:'new'});assert.equal(superseded(),true);
    assert.deepEqual(calls,['retry']);release.resolve();
  });
  assert.deepEqual(calls,['retry','new']);
});
test('duplicate observations share a pending check and later distinct fills are not lost',async()=>{
  const done=deferred(),calls=[],superseded=[];
  const queue=createFillComboQueue(async (fill,options)=>{calls.push(fill.id);superseded.push(options.superseded());if(fill.id==='A')await done.promise});
  await queue.run(async()=>{
    const a=queue.enqueue({id:'A'});assert.equal(queue.enqueue({id:'A'}),a);
    queue.enqueue({id:'B'});done.resolve();
  });
  assert.deepEqual(calls,['A','B']);
  assert.deepEqual(superseded,[true,false]);
});
test('failed combo checks do not fail a confirmed fill or poison subsequent jobs',async()=>{
  const errors=[],calls=[];
  const queue=createFillComboQueue(async fill=>{calls.push(fill.id);if(fill.id==='A')throw Error('quote unavailable');return {filled:false}},
    {onError:(error,fill)=>errors.push([fill.id,error.message])});
  const result=await queue.run(async()=>{queue.enqueue({id:'A'});queue.enqueue({id:'B'});return {singleFilled:true}});
  assert.deepEqual(result,{singleFilled:true});assert.deepEqual(calls,['A','B']);assert.deepEqual(errors,[['A','quote unavailable']]);
});
test('checks retain their own invocation verification time when requests overlap',async()=>{
  const seen=[],first=deferred();
  const queue=createFillComboQueue(async(fill,{verifiedSince})=>{seen.push([fill.id,verifiedSince]);if(fill.id==='A')await first.promise});
  const a=new Date('2026-10-31T19:00:00Z'),b=new Date('2026-10-31T19:01:00Z');
  const one=queue.run(async()=>{queue.enqueue({id:'A'},a)});
  const two=queue.run(async()=>{queue.enqueue({id:'B'},b)});
  first.resolve();await Promise.all([one,two]);assert.deepEqual(seen,[['A',a],['B',b]]);
});
test('a later scan error still waits for the already-started fill check',async()=>{
  const done=deferred();let finished=false;
  const queue=createFillComboQueue(async()=>{await done.promise;finished=true});
  const request=queue.run(async()=>{queue.enqueue({id:'A'});throw Error('scan failed afterward')});
  const rejection=assert.rejects(request,/scan failed afterward/);
  await turn();assert.equal(finished,false);done.resolve();await rejection;assert.equal(finished,true);
});
