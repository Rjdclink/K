import test from 'node:test';
import assert from 'node:assert/strict';
import {espnMatches} from '../src/score_verification.mjs';
import {gameState} from '../src/strategy.mjs';
import {espnSoccerLeagueFeed,espnScoreboardUrls} from '../src/espn_scoreboards.mjs';
import {verifyFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';

const start='2026-11-22T23:30:00Z';
const milestone={
  id:'c465d20f-3ed5-5b1f-9a5c-0439ff57fcf3',
  title:'Deportes Limache vs Deportes La Serena',
  start_date:start,type:'soccer_tournament_multi_leg',
  details:{league:'Chile Liga de Primera'}
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

test('current Kalshi soccer leagues route directly to their real ESPN league scoreboards',()=>{
  const leagues=[
    ['Chile Liga de Primera','chi.1'],
    ['Argentine Nacional B','arg.2'],
    ['Argentina Primera Division','arg.1'],
    ['Liga MX','mex.1'],
    ['Bolivia Premier Division','bol.1'],
  ];
  for(const [league,slug] of leagues){
    const fixture={...milestone,details:{league}};
    assert.equal(espnSoccerLeagueFeed(fixture),'soccer/'+slug,league);
    const urls=espnScoreboardUrls('soccer/all',state(),fixture,['20261122']);
    assert.ok(urls.every(url=>url.includes('/soccer/'+slug+'/scoreboard')),league);
  }
  assert.equal(espnSoccerLeagueFeed({...milestone,details:{league:'Unknown Fictional League'}}),null);
});

test('independent Chilean verification uses the exact small ESPN league board instead of a lossy broad all-leagues query',async()=>{
  const urls=[];
  const game=state();
  const result=await verifyFreshEspnSoccerNo(game,milestone,{
    fetcher:async url=>{
      urls.push(url);
      if(!url.includes('/soccer/chi.1/'))throw Error('Broad all-leagues feed intentionally unavailable');
      return new Response(JSON.stringify(board()),{headers:{date:new Date().toUTCString(),'cache-control':'no-store'}});
    }
  });
  assert.ok(result,'small ESPN league feed must independently validate exact Chile fixture');
  assert.equal(urls.length,2,'late UTC kickoff checks both neighboring score dates');
  assert.ok(urls.every(url=>url.includes('/soccer/chi.1/')));
});
