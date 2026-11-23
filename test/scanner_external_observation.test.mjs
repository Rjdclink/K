import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 normalizeScannerExternalObservation,nearScanExternalObservations,
 promotedFromExternalObservation
} from '../src/scanner_external_observation.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';

const mk=(type,sport,id)=>({
 milestone:{id,type,title:'Away at Home',start_date:'2026-11-22T20:20:00Z',details:{league:sport}},
 state:{id,type,sport,verifiedLive:false,scoreKnown:false,home:NaN,away:NaN}
});
const proof=(game,extra={})=>({
 source:'ESPN',eventId:'espn-42',gameId:game.state.id,live:true,
 home:3,away:2,period:2,seconds:418,elapsedMinute:77,sourceAgeMs:800,
 ...extra
});

test('all enabled sport families can receive a fresh independent clock and score even if Kalshi still says scheduled',()=>{
 for(const [type,sport] of [
  ['football_game','NFL'],['hockey_match','NHL'],['soccer_tournament_multi_leg','Soccer']
 ]){
  const game=mk(type,sport,'id-'+sport);
  const result=normalizeScannerExternalObservation(game,proof(game),Date.parse('2026-11-23T02:10:00Z'));
  assert.equal(result.status,'live');
  assert.equal(result.home,3);
  assert.equal(result.away,2);
  assert.equal(result.source,'ESPN');
  assert.match(result.time_left,/Quarter|Period|match/);
  assert.ok(result.clock_seconds>=0);
  assert.equal(game.state.verifiedLive,false,'independent observation must not mutate Kalshi entry authorizations');
 }
});

test('an ESPN score without a trustworthy live clock must remain incomplete, not a fake live game',()=>{
 const game=mk('hockey_tournament','AHL','ahl');
 const noClock=normalizeScannerExternalObservation(game,proof(game,{seconds:NaN,elapsedMinute:NaN}),Date.now());
 assert.equal(noClock.status,'no_clock');
 assert.equal(noClock.home,null);
 assert.equal(noClock.clock_seconds,null);
 assert.equal(normalizeScannerExternalObservation(game,false,Date.now()).status,'conflict');
 assert.equal(normalizeScannerExternalObservation(game,null,Date.now()).status,'unavailable');
 assert.equal(normalizeScannerExternalObservation(game,proof(game,{live:false}),Date.now()).status,'not_live');
 assert.equal(normalizeScannerExternalObservation(game,proof(game,{sourceAgeMs:16000}),Date.now()).status,'unavailable');
 assert.equal(normalizeScannerExternalObservation(game,proof(game,{seconds:null,elapsedMinute:null}),Date.now()).status,'no_clock');
});

test('external score can elevate near-tier scheduling without giving the trade scanner a fake Kalshi live observation',()=>{
 const game=mk('football_game','NFL','late-nfl');
 const read=normalizeScannerExternalObservation(game,proof(game,{period:4,seconds:120}),Date.now());
 const promoted=promotedFromExternalObservation(game,read);
 assert.equal(promoted.state.verifiedLive,true);
 assert.equal(promoted.state.remainingSeconds,120);
 assert.equal(game.state.verifiedLive,false);
 assert.equal(promoted.state.scoreKnown,false,'promotion is only scheduling metadata');
});

test('near worker probes ESPN or fallback for all selected sports in parallel and records each result',async()=>{
 const games=[mk('football_game','NFL','nfl'),mk('hockey_match','NHL','nhl'),
  mk('soccer_match','Soccer','soccer'),mk('basketball_game','NBA','nba')];
 const calls=[];
 const outputs=await nearScanExternalObservations(games,{
  verify:async g=>{calls.push(g.milestone.id);return proof(g)},
  now:()=>Date.parse('2026-11-23T02:10:00Z')
 });
 assert.deepEqual(calls.sort(),['nfl','nhl','soccer']);
 assert.equal(outputs.length,3);
 assert.ok(outputs.every(o=>o.status==='live'));
});

test('independent source verifier can be invoked for observation without bypassing the default Kalshi-live entry guard',async()=>{
 const game=mk('football_game','NFL','fixture');
 const reply={ok:true,headers:{get:()=>null},json:async()=>({events:[{
  id:'match42',date:game.milestone.start_date,competitions:[{
   status:{period:4,displayClock:'01:59',type:{state:'in',completed:false}},
   competitors:[
    {homeAway:'home',score:'10',team:{name:'Home',displayName:'Home'}},
    {homeAway:'away',score:'7',team:{name:'Away',displayName:'Away'}}
   ]
  }]
 }]})};
 const blocked=await fetchIndependentMatchScore(game.state,game.milestone,{
  espnFeed:'football/nfl',fetcher:async()=>reply,fixtureCache:null
 });
 assert.equal(blocked,null,'trade default cannot read external proof for unconfirmed Kalshi live game');
 const reading=await fetchIndependentMatchScore(game.state,game.milestone,{
  requireKalshiLive:false,espnFeed:'football/nfl',fetcher:async()=>reply,fixtureCache:null
 });
 assert.equal(reading?.source,'ESPN');
 assert.equal(reading?.seconds,119);
 assert.equal(reading?.home,10);
 assert.equal(reading?.away,7);
});

test('near-tier code runs independent probes and persists their results before the next 30s pass',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const near=src.slice(src.indexOf('async function scanNearPriorityGames('),src.indexOf('async function scanFastPriorityGames('));
 assert.match(near,/nearScanExternalObservations\(/);
 assert.match(near,/espnFeed:feeds\.espn,foxFeed:feeds\.fox/);
 assert.match(near,/publishNearExternalObservations\(/);
 assert.match(near,/promotedFromExternalObservation\(/);
 assert.doesNotMatch(near,/scanCollegeTotalNos\(|scanHockeyTotalNos\(|scanSoccerTotalNos\(/);
 assert.match(src,/LEFT JOIN sports_external_observations/);
});

test('already-finished football fixtures cannot reappear as unverified live candidates from the old Kalshi catalog',async()=>{
 const {upcomingScannedGames}=await import('../src/dashboard_upcoming.mjs');
 const gameId='finished-nfl';
 const catalog=[{
  id:gameId,title:'MIN Vikings at SF 49ers',type:'football_game',
  start_date:new Date(Date.now()-4*3600000).toISOString(),
  details:{league:'NFL',status:'inprogress'}
 }];
 assert.equal(upcomingScannedGames(catalog,{excludeIds:new Set([gameId])}).length,0);
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/const excludeIds=new Set\(\[\.\.\.snap\.rows,\.\.\.terminal\.rows\]/);
 assert.match(src,/excludeIds:new Set\(\[\.\.\.snap\.rows,\.\.\.terminal\.rows\]/);
});
