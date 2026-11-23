import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeScannerMilestones} from '../src/discovery.mjs';

const game=(id,type='football_game')=>({id,title:id,type,start_date:new Date().toISOString(),details:{status:'scheduled',league:'NFL'}});
test('discovery scanner includes new football, soccer and hockey beside already-tracked live games',()=>{
  const saved=[game('old-live'),game('new-football'),game('new-hockey','hockey_match'),game('new-soccer','soccer_tournament_multi_leg'),game('nba','basketball_game')];
  const result=mergeScannerMilestones([game('old-live')],saved);
  assert.deepEqual(result.map(g=>g.id),['old-live','new-football','new-hockey','new-soccer']);
  assert.equal(mergeScannerMilestones([],saved).length,4);
});
test('the active discovery tick seeds scans from the persisted catalog even when known-live is nonempty',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const route=source.slice(source.indexOf("if(req.method==='POST'&&(url.pathname==='/tick'"));
  assert.match(route,/SELECT milestones FROM sports_discovery_cache WHERE id=1/);
  assert.match(route,/cached=mergeScannerMilestones\(/);
  assert.doesNotMatch(route,/cached=knownLive\.map\(row=>row\.milestone\)/);
});
