import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishPendingSportsPreview} from '../src/scanner_pending_preview.mjs';

const monitored=(id,type,sport='NFL',status='scheduled',verifiedLive=false)=>({
 milestone:{id,title:id,type,start_date:'2026-11-23T01:20:00Z',details:{league:sport}},
 state:{id,title:id,type,sport,status,verifiedLive,home:0,away:0}
});

test('a newly monitored NFL game is stored before score confirmation, without changing any live score or trade eligibility',async()=>{
 const queries=[],run=async(sql,params)=>{queries.push({sql,params});return {rowCount:params?.length/5||0}};
 const observedAt=new Date('2026-11-23T01:24:00Z');
 const count=await publishPendingSportsPreview([
  monitored('MIN Vikings at SF 49ers','football_game'),
  monitored('Chicago at Vancouver','hockey_match','NHL'),
  monitored('MLS game','soccer_tournament_multi_leg','Soccer','not_started'),
  monitored('prohibited basketball','basketball_game','NBA'),
  monitored('prohibited props','hockey_player_points','NHL'),
  monitored('already live','football_game','NFL','live',true),
  monitored('finished','hockey_match','NHL','final',false)
 ],run,observedAt);
 assert.equal(count,3);
 assert.equal(queries.length,1);
 const {sql,params}=queries[0];
 assert.match(sql,/INSERT INTO game_snapshots/);
 assert.match(sql,/ON CONFLICT/);
 assert.match(sql,/game_snapshots\.status='inactive'/);
 assert.match(sql,/home=NULL,away=NULL/,'unverified kickoff cannot be a verified zero-zero score');
 assert.ok(params.includes('MIN Vikings at SF 49ers'));
 assert.ok(params.includes('Soccer'));
 assert.ok(!params.includes('prohibited basketball'));
 assert.ok(!params.includes('already live'));
 assert.ok(!params.includes('finished'));
 assert.ok(params.some(p=>p instanceof Date));
});

test('the active scanner persists freshly monitored fixtures before any slow market catalog or external verification',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const block=source.slice(source.indexOf('async function scan(cachedMilestones'));
 const pending=block.indexOf('await publishPendingSportsPreview(games,');
 const market=block.indexOf('await marketMap(');
 assert.ok(pending>0&&market>pending,'safe pending observations must not wait for slow markets');
 assert.ok(block.indexOf('await publishLivePreview(active')>pending,'live scores retain independent authority');
});

test('active team-game score polling does not request prohibited player-stat data',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const from=source.indexOf('async function liveBatch(ms)');
 const to=source.indexOf('// Revalidate a bounded set of old fixtures',from);
 assert.ok(from>0&&to>from);
 assert.doesNotMatch(source.slice(from,to),/include_player_stats/,
  'active sports polling must not request banned player prop statistics');
});

test('a Kalshi start-delayed MLS fixture is persisted as an unverified observation, never a live score or trade signal',async()=>{
 const game={
  milestone:{id:'3c7bc653-e22b-5546-88c7-03c22b7a2ef0',
   title:'Vancouver vs Salt Lake',type:'soccer_tournament_multi_leg',
   start_date:'2026-11-23T01:30:00Z',
   details:{league:'MLS',status:'not_started'}},
  state:{id:'3c7bc653-e22b-5546-88c7-03c22b7a2ef0',
   title:'Vancouver vs Salt Lake',type:'soccer_tournament_multi_leg',
   sport:'Soccer',verifiedLive:false,status:'delayed',scoreKnown:true,
   home:0,away:0}
 };
 const calls=[];
 const count=await publishPendingSportsPreview([game],async(sql,params)=>{
  calls.push({sql,params});return {rowCount:1};
 },new Date('2026-11-23T01:36:00Z'));
 assert.equal(count,1,'Kalshi delayed kickoff still requires a real scan observation');
 assert.equal(calls.length,1);
 assert.equal(calls[0].params[0],game.milestone.id);
 assert.match(calls[0].sql,/home=NULL,away=NULL/);
 assert.ok(calls[0].sql.includes("signals='[]'::jsonb"));
});
