import test from 'node:test';
import assert from 'node:assert/strict';
import {espnMatches} from '../src/score_verification.mjs';
import {gameState} from '../src/strategy.mjs';
import {verifyFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';

const start='2026-11-22T23:30:00Z';
const milestone={
  id:'c465d20f-3ed5-5b1f-9a5c-0439ff57fcf3',
  title:'Deportes Limache vs Deportes La Serena',
  start_date:start,type:'soccer_tournament_multi_leg',
  details:{league:'Chile Primera Division'}
};
const board=(away='La Serena',date=start)=>({events:[{
  id:'live-chile-espn-1',name:'La Serena at Deportes Limache',date,
  competitions:[{competitors:[
    {homeAway:'home',team:{displayName:'Deportes Limache',shortDisplayName:'Limache',abbreviation:'LIM'},score:'1'},
    {homeAway:'away',team:{displayName:away,shortDisplayName:away,abbreviation:'LSE'},score:'2'}
  ],status:{period:2,displayClock:"88'",type:{state:'in',completed:false}}}]
}]});
const state=()=>gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{
  status:'live',half:'2nd',time:"88'",home_same_game_score:1,away_same_game_score:2,
  period_scores:[{number:1,type:'regular_period',home_score:0,away_score:0},{number:2,type:'regular_period',home_score:1,away_score:2}]
}});
test('actual ESPN La Serena abbreviation identifies exact Chile Kalshi matchup, not a different team',()=>{
  const game=state();
  assert.equal(game.verifiedLive,true);
  assert.equal(game.scoreKnown,true);
  assert.equal(espnMatches(board(),game,milestone).length,1,'the currently live matching ESPN fixture must be recognized');
  assert.equal(espnMatches(board('La Serena B'),game,milestone).length,0,'different team must not be conflated');
  assert.equal(espnMatches(board('La Serena','2026-11-23T07:00:00Z'),game,milestone).length,0,'different kickoff must not be conflated');
});
test('the independent Chile soccer NO preflight accepts an independently live exact match and rejects ambiguous opponents',async()=>{
  const game=state();
  const fixture=board();
  const fetcher=async()=>new Response(JSON.stringify(fixture),{status:200,
    headers:{date:new Date().toUTCString(),'cache-control':'no-store'}});
  const approved=await verifyFreshEspnSoccerNo(game,milestone,{fetcher});
  assert.ok(approved,'real ESPN two-team match must be available for the independently timed NO preflight');
  assert.equal(approved.source,'ESPN');
  assert.equal(approved.period,2);
  assert.equal(approved.home,1);
  assert.equal(approved.away,2);
  const invalid=await verifyFreshEspnSoccerNo(state(),milestone,{fetcher:async()=>new Response(JSON.stringify(board('La Serena B')),{headers:{date:new Date().toUTCString()}})});
  assert.equal(invalid,null,'unknown opponent still fails closed');
});
