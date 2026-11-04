import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {writeScoreSnapshots,observedSnapshotGames} from '../src/snapshots.mjs';
import {gameState,leadSignal} from '../src/strategy.mjs';
import {gameTimeLabel,storedClockSeconds} from '../src/discovery.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const milestone={id:'ncaa',title:'Arkansas-Pine Bluff at Tarleton St.',type:'basketball_game',details:{league:'NCAAWB'}};
const feed=(clock,status='inprogress')=>({milestone_id:'ncaa',type:'basketball_game',
  _observed_at:new Date().toISOString(),details:{period:4,status,provider:'opticodds',away_points:47,home_points:66,
    widget_status:status==='closed'?'finished':'live',period_remaining_time:clock,last_updated_ts:Date.now()/1000}});

test('observed Kalshi end-of-quarter text is displayed without inventing an entry countdown',()=>{
  const state=gameState(milestone,feed('End of 4th Quarter'));
  assert.equal(state.verifiedLive,true);
  assert.equal(gameTimeLabel(state),'End of 4th Quarter');
  assert.ok(Number.isNaN(state.remainingSeconds));
  assert.equal(leadSignal(state,{event_ticker:'KXNCAAWBGAME-X',ticker:'KXNCAAWBGAME-X-TARL',status:'active'}),null);
  assert.equal(gameTimeLabel(gameState(milestone,feed(''))),'Live clock unavailable');
  assert.equal(gameTimeLabel(gameState(milestone,feed('00:00','closed'))),'Final');
  assert.equal(gameTimeLabel(gameState(milestone,feed('Halftime'))),'Halftime');
});

test('finished and stale tracked games reach persistence; absent feed entries do not fabricate a final',()=>{
  const ms=[milestone,{...milestone,id:'missing'},{...milestone,id:'new-final'},{...milestone,id:'stale'}];
  const stale=feed('00:30');stale.details.last_updated_ts-=180;
  const liveMap=new Map([['ncaa',feed('00:00','closed')],['new-final',feed('00:00','closed')],['stale',stale]]);
  const games=ms.map(m=>({milestone:m,state:gameState(m,liveMap.get(m.id))}));
  const saved=observedSnapshotGames(games,liveMap,new Set(['ncaa','missing','stale']));
  assert.deepEqual(saved.map(g=>g.milestone.id),['ncaa','stale']);
  assert.equal(saved[0].state.status,'closed');
  assert.equal(saved[1].state.verifiedLive,false);
});

test('Postgres snapshot lifecycle orders observations, accepts corrections, and retires final games',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE game_snapshots(id text PRIMARY KEY,title text,sport text,sport_family text,
      home numeric,away numeric,status text,progress numeric,period text,time_left text,clock_seconds integer,
      clock_label text,clock_observed_at timestamptz,scanned_at timestamptz,signals jsonb,
      possession_side text,home_team_id text,away_team_id text,score_observed_at timestamptz);
      CREATE TABLE lead_watch_milestones(game_id text PRIMARY KEY,milestone jsonb);
      CREATE TABLE scan_status(id integer PRIMARY KEY,clock_refresh_at timestamptz);
      INSERT INTO scan_status(id) VALUES(1);`);
    const query=(sql,args)=>db.query(sql,args);
    const start=Date.now()-10000,oldMarket=new Date(start-2*3600000);
    const row=(offset,seconds=30,label='Quarter 4 left',status='live')=>['ncaa',milestone.title,'NCAAW','basketball_game',66,47,status,.99,'4',
      status==='final'?'Final':`Quarter 4 · ${seconds} remaining`,status==='final'?null:seconds,label,new Date(start+offset),oldMarket,
      JSON.stringify([{strategy:'lead',ticker:'M'}]),null,null,null];
    await writeScoreSnapshots(query,[row(0)]);
    // A later score must not advance the market/quote freshness timestamp.
    await writeScoreSnapshots(query,[row(1000,29)]);
    let saved=(await query('SELECT * FROM game_snapshots')).rows[0];
    assert.equal(new Date(saved.scanned_at).getTime(),oldMarket.getTime());
    assert.equal(new Date(saved.score_observed_at).getTime(),start+1000);
    // Official correction increases the clock. The old numeric <= guard lost it.
    await writeScoreSnapshots(query,[row(2000,35)]);
    // A late, older response must not overwrite either score or clock.
    await writeScoreSnapshots(query,[row(500,2)]);
    saved=(await query('SELECT * FROM game_snapshots')).rows[0];
    assert.equal(saved.clock_seconds,35);
    assert.equal(new Date(saved.score_observed_at).getTime(),start+2000);
    await writeScoreSnapshots(query,[row(3000,35)]);
    saved=(await query('SELECT * FROM game_snapshots')).rows[0];
    assert.equal(new Date(saved.clock_observed_at).getTime(),start+2000,'unchanged running clock does not restart extrapolation');
    await writeScoreSnapshots(query,[row(4000,35,'Quarter 4 left · paused')]);
    saved=(await query('SELECT * FROM game_snapshots')).rows[0];
    assert.equal(new Date(saved.clock_observed_at).getTime(),start+4000,'pause transition gets its own observation');

    // Exercise the actual dashboard refresh SQL with a two-hour-old market
    // scan and a current score. It must still fetch and persist the final.
    await query('INSERT INTO lead_watch_milestones VALUES($1,$2)',['ncaa',JSON.stringify(milestone)]);
    let requested=[];
    const context=vm.createContext({pool:{query:async(sql,args)=>{const r=await query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length}}},
      ensureScoreTime:async()=>{},ensureLeadWatch:async()=>{},gameState,gameTimeLabel,storedClockSeconds,writeScoreSnapshots,Date,console,
      liveBatch:async ms=>{requested=ms;return new Map([['ncaa',feed('00:00','closed')]])}});
    vm.runInContext(source.slice(source.indexOf('function snapshotRow('),source.indexOf('async function scanThirdQuarterNos(')),context);
    vm.runInContext(source.slice(source.indexOf('async function refreshOpenClocks('),source.indexOf('let recentDashboardPositions=')),context);
    await context.refreshOpenClocks();
    assert.equal(requested.length,1);
    assert.equal(requested[0].details.league,'NCAAWB','keep full source metadata');
    saved=(await query('SELECT * FROM game_snapshots')).rows[0];
    assert.equal(saved.status,'final');assert.equal(saved.time_left,'Final');assert.equal(saved.clock_seconds,null);
    assert.deepEqual(saved.signals,[]);
    await writeScoreSnapshots(query,[row(5000,1)]);
    assert.equal((await query('SELECT status FROM game_snapshots')).rows[0].status,'final','old scan cannot resurrect the game');
  }finally{await db.close()}
});
