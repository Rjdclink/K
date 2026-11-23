import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('scheduled game scanner polls game scores only, not forbidden player-stat telemetry',()=>{
  const code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function liveBatch(ms)');
  const end=code.indexOf('async function refreshStaleMilestones',start);
  assert.ok(start>0&&end>start);
  const source=code.slice(start,end);
  assert.ok(source.includes("'/live_data/batch?'"),'game score batch is retained');
  assert.doesNotMatch(source,/include_player_stats/,'no live scanner call requests excluded prop data');
  assert.ok(source.includes('map.set(d.milestone_id'),'observations still mapped by exact milestone ID');
});
