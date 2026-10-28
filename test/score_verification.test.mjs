import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/strategy.mjs';
import { espnMatches, foxMatches, scoreAgreement, verifyIndependentOver, playerStatAgreement } from '../src/score_verification.mjs';

const start=new Date(Date.now()-20*60000).toISOString();
const m={id:'nba-game',title:'BKN Nets at BOS Celtics',type:'basketball_game',start_date:start,details:{league:'NBA'}};
const game=gameState(m,{details:{status:'live',home_score:24,away_score:20,quarter:1,clock:'05:00',home_team_name:'BOS Celtics',away_team_name:'BKN Nets'}});
const espn=(home=24,away=20,overrides={})=>({events:[{date:start,status:{type:{state:'in'},period:1,displayClock:'05:00'},competitions:[{competitors:[
  {homeAway:'home',score:String(home),team:{displayName:'Boston Celtics',abbreviation:'BOS',name:'Celtics'}},
  {homeAway:'away',score:String(away),team:{displayName:'Brooklyn Nets',abbreviation:'BKN',name:'Nets'}}
]}],...overrides}]});
const fox=(home=24,away=20,overrides={})=>({sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:'05:00',entityLink:{layout:{tokens:{homeUri:'team-bos',awayUri:'team-bkn'}}},upperTeam:{uri:'team-bkn',name:'BKN',longName:'Nets',score:away},lowerTeam:{uri:'team-bos',name:'BOS',longName:'Celtics',score:home},...overrides}]}]});

test('independent scoreboards must match the exact live fixture and both team scores',()=>{
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),foxMatches(fox(),game,m)]),true);
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),foxMatches(fox(25),game,m)]),false,'one conflicting feed vetoes');
  assert.equal(scoreAgreement(game,[espnMatches(espn(25),game,m),[]]),false);
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),[]]),true);
  assert.equal(scoreAgreement(game,[[],[]]),false,'no coverage');
  assert.equal(scoreAgreement(game,[espnMatches(espn(20,24),game,m),[]]),false,'home and away cannot swap');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{date:new Date(Date.now()-86400000).toISOString()}),game,m),[]]),false,'wrong fixture time');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{status:{type:{state:'pre'},period:1,displayClock:'05:00'}}),game,m),[]]),false,'scheduled score');
  assert.equal(scoreAgreement(game,[[],foxMatches(fox(24,20,{eventStatus:3}),game,m)]),false,'final score cannot confirm a live game');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{status:{type:{state:'in'},period:1,displayClock:'11:00'}}),game,m),[]]),false,'stale clock');
  assert.equal(scoreAgreement(game,[espnMatches({events:[...espn().events,...espn().events]},game,m),[]]),false,'ambiguous duplicate');
  assert.equal(scoreAgreement(game,[[],foxMatches(fox(24,20,{entityLink:{layout:{tokens:{homeUri:'team-bkn',awayUri:'team-bos'}}}}),game,m)]),false,'FOX row orientation cannot be guessed');
});

test('every over preflight needs ESPN or FOX; missing data and requests fail closed',async()=>{
  const fetcher=async url=>({ok:true,json:async()=>url.includes('espn.com')?espn():fox()});
  assert.equal(await verifyIndependentOver(game,m,{fetcher}),true);
  assert.equal(await verifyIndependentOver(game,m,{fetcher:async url=>({ok:true,json:async()=>url.includes('espn.com')?espn(0,0):fox(0,0)})}),false);
  assert.equal(await verifyIndependentOver(game,m,{fetcher:async()=>{throw Error('provider unavailable')}}),false);
  const unknown={...m,type:'hockey_match',details:{league:'KHL'}};
  const unknownGame=gameState(unknown,{details:{status:'live',home_score:2,away_score:1}});
  assert.equal(await verifyIndependentOver(unknownGame,unknown,{fetcher}),false,'unmapped league cannot borrow NBA scores');
  const soccer={id:'cup-game',type:'soccer_match',title:'Dolomiti Bellunesi vs Desenzano',start_date:start};
  const soccerGame=gameState(soccer,{details:{status:'live',home_score:1,away_score:0,time:"20'"}});
  assert.equal(await verifyIndependentOver(soccerGame,soccer,{fetcher}),false,'the incident game is absent from both providers');
});

test('FOX soccer home team may be the upper row',()=>{
  const fixture={id:'milan-game',type:'soccer_match',title:'AC Milan vs Bologna',start_date:start};
  const state=gameState(fixture,{details:{status:'live',home_score:2,away_score:1,time:"35'",home_team_name:'AC Milan',away_team_name:'Bologna'}});
  const data={sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:"35'",entityLink:{layout:{tokens:{homeUri:'milan',awayUri:'bologna'}}},upperTeam:{uri:'milan',longName:'AC Milan',score:2},lowerTeam:{uri:'bologna',longName:'Bologna',score:1}}]}]};
  assert.equal(scoreAgreement(state,[[],foxMatches(data,state,fixture)]),true);
});
test('a period total requires an independent matching period breakdown, not just game scores',()=>{
  const board={...game,periodScores:[{number:1,home:14,away:10}]};
  const contract={event_ticker:'KXNBA1QTOTAL-26OCT28BOSBKN'};
  const same={source:'ESPN',home:24,away:20,live:true,clockOk:true,periods:[{number:1,home:14,away:10}]};
  assert.equal(scoreAgreement(board,[[same],[]],contract),true);
  assert.equal(scoreAgreement(board,[[{...same,periods:[{number:1,home:13,away:11}]}],[]],contract),false);
  assert.equal(scoreAgreement(board,[[],[{source:'FOX Sports',home:24,away:20,live:true,clockOk:true}]],contract),false);
});
test('player point and PRA overs require the named ESPN athlete and matching boxscore stat',async()=>{
  const live={milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status:'live',home_score:24,away_score:20,quarter:1,clock:'05:00',last_updated_ts:Date.now()/1000,player_stats:{player1:{points:16,rebounds:4,assists:3}}}};
  const state=gameState(m,live);
  const market={event_ticker:'KXNBAPTS-DATE',status:'active',title:'Player points',yes_sub_title:'Cade Cunningham: 15+',rules_primary:'Cade Cunningham records 15+ points',custom_strike:{basketball_player:'player1'},floor_strike:14.5,yes_ask_dollars:'0.90'};
  const summary={boxscore:{players:[{statistics:[{names:['PTS','REB','AST'],athletes:[{athlete:{displayName:'Cade Cunningham'},stats:['16','4','3']}]}]}]}};
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PTS',value:16}),true);
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PRA',value:23}),true);
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PTS',value:17}),false);
  const board=espn(24,20,{id:'espn-game'});
  const fetcher=async url=>({ok:true,json:async()=>url.includes('/summary?')?summary:url.includes('espn.com')?board:fox()});
  assert.equal(await verifyIndependentOver(state,m,{fetcher,market}),true);
  assert.equal(await verifyIndependentOver({...state,playerStats:{player1:{points:17,rebounds:4,assists:3}}},m,{fetcher,market}),false);
  assert.equal(await verifyIndependentOver(state,m,{fetcher:async url=>({ok:true,json:async()=>url.includes('/summary?')?{boxscore:{players:[]}}:url.includes('espn.com')?board:fox()}),market}),false);
});
