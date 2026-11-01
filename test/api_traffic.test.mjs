import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('429 responses coordinate Retry-After across scanner instances',()=>{
 assert.match(source,/retryDelay\(response.headers.get\('retry-after'\),attempt\)/);
 assert.match(source,/UPDATE kalshi_rate_limits SET next_at=GREATEST/);
 assert.match(source,/await kalshiBackoff/);
});
test('recent event results are cached without caching final order quotes',()=>{
 assert.match(source,/const eventCache=new Map\(\)/);
 assert.match(source,/Date.now\(\)-cached.at<7000/);
 assert.match(source,/eventCache.set\(e.event_ticker/);
 assert.match(source,/await kalshi\('\/markets\/'/);
});
test('executable opportunities take priority over nonexecutable signals',()=>{
 assert.match(source,/if\(executable\(a\)!==executable\(b\)\)return executable\(a\)\?-1:1/);
 assert.match(source,/const pause=Math.max\(0,3000-/);
});
test('fast lead polling does not wait for the prior scan to mark a game watchable',()=>{
 assert.match(source,/SELECT w\.milestone FROM lead_watch_milestones w\s+JOIN game_snapshots g ON g\.id=w\.game_id/);
 assert.doesNotMatch(source,/WHERE watchable AND updated_at/);
 assert.match(source,/\.filter\(g=>leadWatchReason\(g\.state\)\)/);
});

