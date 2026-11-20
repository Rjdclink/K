import test from 'node:test';
import assert from 'node:assert/strict';
import {selectStaleReviews,classifyStaleLive,retainedAfterStaleReview} from '../src/stale_review.mjs';

const now=Date.parse('2026-11-20T22:00:00Z');
const m=(id,ageHours=12)=>({id,type:'basketball_game',start_date:new Date(now-ageHours*3600000).toISOString(),details:{status:'inprogress'}});
const reading=(id,status,lastUpdated=now,home=12,away=8)=>({milestone_id:id,details:{status,home_points:home,away_points:away,last_updated_ts:lastUpdated/1000},_observed_at:new Date(now).toISOString()});

test('old milestones are revisited in bounded, fair batches, with cooldown for unavailable feed responses',()=>{
 const milestones=[m('a'),m('b'),m('c'),m('new',1)];
 assert.deepEqual(selectStaleReviews(milestones,[],now,2).map(x=>x.id),['a','b']);
 const reviews=[{game_id:'a',outcome:'unknown',checked_at:new Date(now-60000).toISOString()},
  {game_id:'b',outcome:'live',checked_at:new Date(now-30000).toISOString()}];
 assert.deepEqual(selectStaleReviews(milestones,reviews,now,2).map(x=>x.id),['c']);
 assert.deepEqual(selectStaleReviews(milestones,reviews,now+6*60000,3).map(x=>x.id),['a','b','c']);
});

test('fresh confirmed live games are recovered; terminal scores are pruned; missing or old source timestamps remain uncertain',()=>{
 assert.equal(classifyStaleLive(m('game'),reading('game','in_progress'),now),'live');
 assert.equal(classifyStaleLive(m('game'),reading('game','closed'),now),'terminal');
 assert.equal(classifyStaleLive(m('game'),reading('game','final'),now),'terminal');
 assert.equal(classifyStaleLive(m('game'),null,now),'unknown');
 assert.equal(classifyStaleLive(m('game'),reading('other','inprogress'),now),'unknown');
 assert.equal(classifyStaleLive(m('game'),reading('game','inprogress',now-5*60000),now),'unknown');
 const missing=reading('game','live');delete missing.details.last_updated_ts;
 assert.equal(classifyStaleLive(m('game'),missing,now),'unknown');
 assert.equal(classifyStaleLive(m('game'),reading('game','suspended'),now),'unknown');
});

test('only independently refreshed confirmed terminal entries disappear from active discovery; recent or uncertain items are retained',()=>{
 const milestones=[m('closed'),m('live'),m('unknown'),m('recent',1)];
 const reviews=[{game_id:'closed',outcome:'terminal',checked_at:new Date(now-120000).toISOString()},
  {game_id:'live',outcome:'live',checked_at:new Date(now-30000).toISOString()},
  {game_id:'unknown',outcome:'unknown',checked_at:new Date(now-30000).toISOString()}];
 assert.deepEqual(retainedAfterStaleReview(milestones,reviews,now).map(x=>x.id),['live','unknown','recent']);
 assert.deepEqual(retainedAfterStaleReview(milestones,reviews,now+25*3600000).map(x=>x.id),
   ['closed','live','unknown','recent'],'terminal suppression is not permanent');
});
