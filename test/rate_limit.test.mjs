import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('every Kalshi API request is gated by a shared read/write rate limiter',()=>{
 assert.match(source,/await kalshiRateLimit\(method\)/);
 assert.match(source,/pg_advisory_xact_lock/);
 assert.match(source,/kalshi_rate_limits/);
 assert.match(source,/method==='GET'\?\d+:\d+/);
});
