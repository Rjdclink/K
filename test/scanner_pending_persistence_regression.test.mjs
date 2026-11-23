import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gameTimeLabel,storedClockSeconds} from '../src/discovery.mjs';
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

test('the later scanner snapshot write never turns a delayed 0–0 into a verified score, but preserves genuinely final scores',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function snapshotRow(');
 const end=source.indexOf('async function publishLivePreview(',start);
 assert.ok(start>0&&end>start);
 const snapshotRow=vm.runInNewContext(source.slice(start,end)+';snapshotRow',
   {gameTimeLabel,storedClockSeconds});
 const milestone={id:'soccer-delayed',type:'soccer_tournament_multi_leg',
   title:'Vancouver vs Salt Lake',start_date:'2026-11-23T01:30:00Z',
   details:{league:'MLS',status:'not_started'}};
 const observedAt=new Date('2026-11-23T01:40:00Z');
 const liveMap=new Map([[milestone.id,{_observed_at:observedAt.toISOString()}]]);
 const unconfirmed={id:milestone.id,title:milestone.title,sport:'Soccer',
   type:milestone.type,status:'delayed',verifiedLive:false,
   scoreKnown:true,home:0,away:0,period:1,soccerMinute:0,progress:0};
 const row=snapshotRow({milestone,state:unconfirmed},liveMap,observedAt);
 assert.equal(row[4],null,'zero score before kickoff is not verified evidence');
 assert.equal(row[5],null);
 assert.equal(row[6],'inactive');
 assert.equal(row[7],null,'unverified game progress cannot be presented as live');
 assert.equal(row[8],'','unverified first period is not a live quarter or half');
 assert.deepEqual(row[14],'[]','no actionable quote or preflight is generated');
 const verified=snapshotRow({milestone,state:{...unconfirmed,verifiedLive:true,
   status:'live',scoreKnown:true,home:2,away:1,period:2,soccerMinute:85,
   matchRemainingSeconds:300,progress:.9}},liveMap,observedAt);
 assert.equal(verified[4],2);
 assert.equal(verified[5],1);
 assert.equal(verified[6],'live');
 const final=snapshotRow({milestone,state:{...unconfirmed,status:'final',
   verifiedLive:false,scoreKnown:true,home:3,away:2,period:2}},liveMap,observedAt);
 assert.equal(final[4],3,'confirmed final scores remain visible for historical holdings');
 assert.equal(final[5],2);
 assert.equal(final[6],'final');
});
