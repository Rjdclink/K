import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {externalScoreFeeds} from '../src/score_verification.mjs';

test('held legacy team-winner external checks reuse the known exact feeds for NFL, basketball, NHL, MLB, and lacrosse',()=>{
 for(const [sport,type,league,expected] of [
  ['NFL','football_game','NFL','football/nfl'],
  ['NBA','basketball_game','NBA','basketball/nba'],
  ['CFB','football_game','NCAAFB','football/college-football'],
  ['NHL','hockey_match','NHL','hockey/nhl'],
  ['MLB','baseball_game','MLB','baseball/mlb'],
  ['NLL','lacrosse_game','NLL','lacrosse/nll']
 ]){
  const milestone={id:'test-'+sport,details:{league},type};
  const feeds=externalScoreFeeds({id:milestone.id,type,sport,competition:league},milestone);
  assert.equal(feeds.espn,expected,sport);
 }
});
test('fast protective exits use the same existing source resolver and do not create new buying eligibility',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/externalScoreFeeds\(game,milestone\)/);
 assert.match(src,/externallyScoredGame\(state,gameInfo.get\(gameId\).milestone,\{fresh:true,market\}\)/);
});
