import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationStatus} from '../src/verification_status.mjs';

test('dashboard separates absent soccer coverage from a conflicting independent score',()=>{
  assert.match(verificationStatus({passed:false,independent_unavailable:'true'}),/No matching external live score/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false'}),/disagrees with Kalshi/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false',verification_issue:'ESPN goal list confirms 1 of 2 displayed goals'}),/confirms 1 of 2/);
  assert.match(verificationStatus({passed:true,independent_unavailable:'false'}),/External score matched; fresh Kalshi read/);
  assert.match(verificationStatus({passed:true,mode:'kalshi_only_crossed_over'}),/Two Kalshi score checks passed/);
});
