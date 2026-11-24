import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fastEntryCandidates} from '../src/scan_tiers.mjs';

const mk=(type,sport,extra={})=>({
 milestone:{id:type+sport,type,title:type+' '+sport},
 state:{id:type+sport,type,sport,verifiedLive:true,period:4,remainingSeconds:150,...extra}
});

test('urgent lane accepts actual football, hockey and soccer game contracts but no basketball, stats, or player props',()=>{
 const games=[
  mk('football_game','NFL'),mk('football_match','CFB'),
  mk('hockey_match','NHL'),mk('hockey_tournament','AHL'),
  mk('soccer_tournament_multi_leg','Soccer'),
  mk('basketball_game','NBA'),mk('hockey_player_points','NHL'),
  mk('football_game','NFL',{verifiedLive:false})
 ];
 const ready=fastEntryCandidates(games);
 assert.deepEqual(ready.map(g=>g.milestone.type),
  ['football_game','football_match','hockey_match','hockey_tournament','soccer_tournament_multi_leg']);
});

test('urgent scanner evaluates live eligible game families immediately and never invokes player-prop buying',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const worker=source.slice(source.indexOf('async function scanFastPriorityGames('),source.indexOf('const scanMinuteEnd='));
 assert.match(worker,/fastEntryCandidates\(/);
 assert.match(worker,/runImmediateNoFinalPass\(/);
 for(const sport of ["scanCollegeTotalNos(", "scanHockeyTotalNos(", "scanSoccerTotalNos(", "scanEarlyPeriodNos("])
  assert.ok(worker.includes(sport),sport);
 assert.doesNotMatch(worker,/scanVariablePlayerOvers|playerPropEarlyWindow/);
});

test('10-second NO diagnostics preserve an existing YES signal on the same contract',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const worker=src.slice(src.indexOf('async function scanFastPriorityGames('),src.indexOf('const scanMinuteEnd='));
 assert.match(worker,/WHERE NOT \(COALESCE\(s->>'ticker',''\)=ANY\(\$2::text\[\]\) AND COALESCE\(s->>'strategy',''\)='no'\)/);
 for(const name of ['scanCollegeTotalNos','scanHockeyTotalNos','scanEarlyPeriodNos','scanSoccerTotalNos']){
  const start=src.indexOf('async function '+name+'('),end=src.indexOf('\nasync function ',start+1);
  const scanner=src.slice(start,end);
  assert.match(scanner,/list\.findIndex\(row=>row\.ticker===.*&&row\.strategy==='no'\)/,name);
 }
});

test('10-second urgent worker independently starts while retry and safety watchers continue in parallel',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const worker=src.slice(src.indexOf('async function runFastSportsTick(){'),src.indexOf('async function runNearSportsTick(){'));
 assert.match(worker,/runScanTierWindow\('fast'/);
 assert.match(worker,/scanFastPriorityGames\(until\)/);
 assert.match(worker,/Promise\.all\(/);
 assert.doesNotMatch(worker,/const cycles=0/);
});

test('30-second near worker promotes all fresh games without serial external-entry catalog work',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const worker=src.slice(src.indexOf('async function scanNearPriorityGames('),src.indexOf('async function scanFastPriorityGames('));
 assert.match(worker,/promoteScanGames\(games\)/);
 assert.doesNotMatch(worker,/marketMap\(|scanCollegeTotalNos\(|scanHockeyTotalNos\(|scanSoccerTotalNos\(/);
});
