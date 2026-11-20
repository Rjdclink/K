import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {selectStaleReviews,classifyStaleLive,retainedAfterStaleReview} from '../src/stale_review.mjs';

const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const code=src.slice(src.indexOf('async function refreshStaleMilestones('),
 src.indexOf('async function liveMilestone('));
const now=Date.now();
const milestone=id=>({id,type:'basketball_game',
 start_date:new Date(now-10*3600000).toISOString(),details:{league:'NCAAMB',status:'live'}});
const score=(id,status,updated=now)=>({milestone_id:id,
 details:{status,last_updated_ts:updated/1000,home_points:10,away_points:12},
 _observed_at:new Date(now).toISOString()});

test('scanner checks old fixtures, recovers fresh live games, prunes only confirmed terminals from active cache',async()=>{
 const cached=[milestone('ended'),milestone('running'),milestone('unknown')];
 const reviews=new Map(),cache=[...cached];let queries=0,refreshes=0;
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT game_id,checked_at,outcome')){
   return {rows:args[0].filter(id=>reviews.has(id)).map(id=>reviews.get(id))};
  }
  if(sql.startsWith('INSERT INTO sports_stale_reviews')){
   for(let i=0;i<args.length;i+=3)reviews.set(args[i],
    {game_id:args[i],checked_at:args[i+1],outcome:args[i+2]});
   return {rows:[]};
  }
  if(sql.startsWith('UPDATE sports_discovery_cache')){
   queries++;for(const id of args[0]){const index=cache.findIndex(m=>m.id===id);if(index>=0)cache.splice(index,1);}
   return {rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
 const context=vm.createContext({pool,ensureStaleReviewTable:async()=>{},
  liveBatch:async batch=>{refreshes++;return new Map(batch.filter(m=>m.id!=='unknown')
   .map(m=>[m.id,score(m.id,m.id==='ended'?'closed':'inprogress')]));},
  selectStaleReviews,classifyStaleLive,retainedAfterStaleReview,Date,JSON,Set,Map,console});
 vm.runInContext(code,context);
 const out=await context.refreshStaleMilestones(cached);
 assert.deepEqual(Array.from(out.milestones,x=>x.id),['running','unknown']);
 assert.deepEqual(Array.from(out.recoveredIds),['running']);
 assert.deepEqual(cache.map(x=>x.id),['running','unknown']);
 assert.equal(queries,1);
 assert.equal(refreshes,1);
 assert.equal(reviews.get('ended').outcome,'terminal');
 assert.equal(reviews.get('unknown').outcome,'unknown');
 const repeated=await context.refreshStaleMilestones(cached);
 assert.deepEqual(Array.from(repeated.milestones,x=>x.id),['running','unknown']);
 assert.equal(refreshes,1,'review cooldown avoids repeatedly requesting stale fixtures');
});

test('failed refresh retains old fixtures for retry without pruning historical or discovery records',async()=>{
 const cached=[milestone('failing')],cache=[...cached];let writes=0;
 const pool={query:async(sql)=>{if(sql.startsWith('SELECT game_id,checked_at,outcome'))return {rows:[]};writes++;throw Error('unexpected write');}};
 const context=vm.createContext({pool,ensureStaleReviewTable:async()=>{},
   liveBatch:async()=>{throw Error('Kalshi temporarily unavailable')},
   selectStaleReviews,classifyStaleLive,retainedAfterStaleReview,Date,JSON,Set,Map,
   console:{warn:()=>{},info:()=>{}}});
 vm.runInContext(code,context);
 const result=await context.refreshStaleMilestones(cached);
 assert.deepEqual(Array.from(result.milestones,x=>x.id),['failing']);
 assert.deepEqual(cache.map(x=>x.id),['failing']);
 assert.equal(writes,0);
 assert.doesNotMatch(code,/DELETE FROM (?:trade_attempts|trade_history|game_snapshots)/);
});
