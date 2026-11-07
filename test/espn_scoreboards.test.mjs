import test from 'node:test';
import assert from 'node:assert/strict';
import {espnScoreboardUrls} from '../src/espn_scoreboards.mjs';

test('ESPN requests cover the declared college division and all D-I basketball without changing professional feeds',()=>{
  const dates=['20261107','20261107'];
  const groups=(sport,division)=>espnScoreboardUrls('test/feed',{sport},{details:{division}},dates)
    .map(url=>new URL(url).searchParams.get('groups'));
  assert.deepEqual(groups('CFB','FBS'),['80']);
  assert.deepEqual(groups('CFB','FCS'),['81']);
  assert.deepEqual(groups('CFB',''),['80','81']);
  assert.deepEqual(groups('NCAAB'),['50']);
  assert.deepEqual(groups('NCAAW'),['50']);
  assert.deepEqual(groups('NBA'),[null]);
  assert.deepEqual(groups('NFL'),[null]);
});
