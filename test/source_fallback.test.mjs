import test from 'node:test';
import assert from 'node:assert/strict';
import {espnRetryThenFox} from '../src/source_fallback.mjs';

test('successful first ESPN check never requests FOX or repeats ESPN',async()=>{
 const calls=[],proof={source:'ESPN',eventId:'e'};
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return proof},fox:async()=>{calls.push('FOX');return null}});
 assert.equal(actual,proof);assert.deepEqual(calls,['ESPN']);
});
test('initially unavailable ESPN is retried once and preferred over FOX',async()=>{
 const calls=[];const proof={source:'ESPN',eventId:'e'};
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return calls.length===1?null:proof},fox:async()=>{calls.push('FOX');return null}});
 assert.equal(actual,proof);assert.deepEqual(calls,['ESPN','ESPN']);
});
test('FOX is queried only after two unavailable ESPN attempts',async()=>{
 const calls=[];const proof={source:'FOX Sports',eventId:'f'};
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return null},fox:async()=>{calls.push('FOX');return proof}});
 assert.equal(actual,proof);assert.deepEqual(calls,['ESPN','ESPN','FOX']);
});
test('an ESPN contradiction is a veto, never a reason to ask FOX',async()=>{
 const calls=[];
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return false},fox:async()=>{calls.push('FOX');return true}});
 assert.equal(actual,false);assert.deepEqual(calls,['ESPN']);
});
test('a contradiction on ESPN retry is also a veto, never FOX',async()=>{
 const calls=[];
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return calls.length===1?null:false},fox:async()=>{calls.push('FOX');return true}});
 assert.equal(actual,false);assert.deepEqual(calls,['ESPN','ESPN']);
});
test('network exceptions are unavailable, but rejected FOX proof stays rejected',async()=>{
 const calls=[];
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');throw Error('timeout')},fox:async()=>{calls.push('FOX');return false}});
 assert.equal(actual,false);assert.deepEqual(calls,['ESPN','ESPN','FOX']);
});
test('unavailable FOX after retry fails closed and does not add extra calls',async()=>{
 const calls=[];
 const actual=await espnRetryThenFox({espn:async()=>{calls.push('ESPN');return null},fox:async()=>{calls.push('FOX');throw Error('offline')}});
 assert.equal(actual,null);assert.deepEqual(calls,['ESPN','ESPN','FOX']);
});