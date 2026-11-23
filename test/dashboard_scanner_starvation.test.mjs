import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeScannerMilestones,discoverCurrentMilestones,scanMilestones} from '../src/discovery.mjs';

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

test('read-only game catalog retains next-day football but active score scanner keeps its one-hour pregame boundary',async()=>{
  const now=Date.parse('2026-11-23T00:00:00Z');
  const at=h=>new Date(now+h*3600000).toISOString();
  const events=[
    {id:'soon',type:'football_game',title:'Tonight NFL',start_date:at(.5),details:{league:'NFL',status:'scheduled'}},
    {id:'tomorrow',type:'football_game',title:'Tomorrow NFL',start_date:at(20),details:{league:'NFL',status:'scheduled'}},
    {id:'next-week',type:'football_game',title:'Beyond dashboard horizon',start_date:at(28),details:{league:'NFL',status:'scheduled'}},
    {id:'basketball',type:'basketball_game',title:'NBA future',start_date:at(1),details:{league:'NBA',status:'scheduled'}}
  ];
  const requests=[];
  const found=await discoverCurrentMilestones(async path=>{requests.push(path);return {milestones:events,cursor:''};},now,24*3600000);
  assert.deepEqual(found.map(g=>g.id),['soon','tomorrow']);
  assert.deepEqual(scanMilestones(found,new Set(),now).map(g=>g.id),['soon']);
  assert.equal(requests.length,1);
});
