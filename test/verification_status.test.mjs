import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationStatus,completedOverWait,verificationWindowStatus} from '../src/verification_status.mjs';

test('dashboard separates absent soccer coverage from a conflicting independent score',()=>{
  assert.match(verificationStatus({passed:false,independent_unavailable:'true'}),/No matching external live score; entry blocked/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false'}),/disagrees with Kalshi/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false',verification_issue:'ESPN goal list confirms 1 of 2 displayed goals'}),/confirms 1 of 2/);
  assert.match(verificationStatus({passed:true,independent_unavailable:'false'}),/External score matched; fresh Kalshi read/);
  assert.match(verificationStatus({passed:true,mode:'kalshi_only_crossed_over'}),/Two Kalshi score checks passed/);
  assert.match(verificationStatus({passed:true,mode:'seller_backed_cushioned_over'}),/Cushioned over; live seller checked/);
});
test('a completed second external check supersedes only its own pending wait',()=>{
  const signal={verification_wait:{updatedAt:1000}};
  assert.equal(completedOverWait(signal,{passed:true,mode:'independent_timed_over',created_at:new Date(2000).toISOString()}),true);
  assert.equal(completedOverWait(signal,{passed:true,mode:'independent_timed_over',created_at:new Date(999).toISOString()}),false);
  assert.equal(completedOverWait(signal,{passed:false,mode:'independent_timed_over',created_at:new Date(2000).toISOString()}),false);
  assert.equal(completedOverWait(signal,{passed:true,mode:'first_external',created_at:new Date(2000).toISOString()}),false);
});
test('dashboard uses the durable window stage instead of an older wait message',()=>{
  const now=200000,signal={verification_wait:{dueAt:100000,updatedAt:100000}};
  const window={initial_at:100000,last_seen:now-3000,first_external_at:150000};
  const waiting=verificationWindowStatus(signal,window,{stage:'final_wait',remainingMs:37000,minimumMs:137000},now);
  assert.match(waiting.execution,/First external check passed.*37s remaining/);
  assert.deepEqual(waiting.wait,{dueAt:now+37000,updatedAt:now-3000});
  const first=verificationWindowStatus(signal,window,{stage:'first_wait',remainingMs:20000,minimumMs:137000},now);
  assert.deepEqual(first.wait,{dueAt:120000,updatedAt:now-3000});
  assert.match(verificationWindowStatus(signal,window,{stage:'paired'},now).execution,/Second external check due/);
  assert.deepEqual(verificationWindowStatus(signal,{...window,last_seen:now-90001},{stage:'final_wait',remainingMs:37000,minimumMs:137000},now).wait,
    {dueAt:now+37000,updatedAt:now-90001});
});
