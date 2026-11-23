import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDiscovery,supportedScannerSport,scanMilestones} from '../src/discovery.mjs';

test('the scanner admits match/game milestones only, never player-stat milestone families',()=>{
 for(const type of ['football_game','hockey_match','hockey_tournament',
   'soccer_tournament_multi_leg','hockey_game','soccer_match','soccer_game'])
   assert.equal(supportedScannerSport({type}),true,type);
 for(const type of ['hockey_player_points','football_player_yards',
   'soccer_player_goals','basketball_game','hockey_props'])
   assert.equal(supportedScannerSport({type}),false,type);
});

test('full catalog refresh covers 24 hours behind and next day without a seven-day player-stat pagination backlog',async()=>{
 const now=Date.parse('2026-11-23T01:30:00Z'),searches=[];
 const reply=async url=>{
   const u=new URL(url,'https://kalshi.test');
   searches.push(u.searchParams.get('minimum_start_date'));
   return {milestones:[{id:'nfl',type:'football_game',title:'NFL',
     start_date:new Date(now+45*60000).toISOString(),
     details:{league:'NFL',status:'scheduled'}}],cursor:''};
 };
 const catalog=await refreshDiscovery(reply,{milestones:[],
   full_discovered_at:new Date(now-16*60000).toISOString()},now);
 assert.deepEqual(searches,[new Date(now-24*3600000).toISOString()]);
 assert.deepEqual(scanMilestones(catalog.milestones,new Set(),now).map(x=>x.id),['nfl']);
});

test('live discovery scanner coverage retains NHL, soccer and NFL while keeping the one-hour pregame polling boundary',()=>{
 const now=Date.parse('2026-11-23T01:30:00Z');
 const item=(id,type,h)=>({id,title:id,type,start_date:new Date(now+h*3600000).toISOString(),details:{status:'scheduled'}});
 const games=[item('nfl','football_game',.5),item('hockey','hockey_match',-1),
   item('soccer','soccer_tournament_multi_leg',-.5),item('tomorrow-nfl','football_game',18),
   item('old-football','football_game',-24),item('basketball','basketball_game',0)];
 assert.deepEqual(scanMilestones(games,new Set(),now).map(x=>x.id),['nfl','hockey','soccer']);
});
