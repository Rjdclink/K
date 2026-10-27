import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal,leadSignal,orderSize,estimatedCostCents,overBudget} from '../src/strategy.mjs';

const milestone={id:'game-1',title:'Boston at New York',type:'basketball_game',details:{competition:'Pro Basketball (M)'},related_event_tickers:['GAME']};
const live=(home,away,quarter=4)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_score:home,away_score:away,quarter,clock:'05:00',home_team_name:'New York',away_team_name:'Boston'}});
test('over requires strict threshold exceeded and whole-game contract',()=>{
  const g=gameState(milestone,live(102,101));const market={status:'active',title:'Total points in game over 203',rules_primary:'Combined total points scored in the game',strike_type:'greater',floor_strike:203};
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.8);
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('Kalshi whole-game over wording is recognized after the line is crossed',()=>{
  const m={id:'kbo-game',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const g=gameState(m,{details:{status:'inprogress',away_points:3,home_points:8,inning:9}});
  const market={status:'active',title:'Over 9.5 runs scored?',yes_sub_title:'Over 9.5 runs scored',rules_primary:'If the teams collectively score more than 9.5 runs in the KBO game, the market resolves to Yes.',strike_type:'greater',floor_strike:9.5};
  assert.equal(overSignal(g,market)?.fraction,.8);
  assert.equal(overSignal(g,{...market,title:'Over 11.5 runs scored?',floor_strike:11.5}),null);
  assert.equal(orderSize(5097,'1.0000','0.00',.8),0);
});
test('late lead requires verified live score, leader identity, and progress',()=>{
  const market={status:'active',title:'Will New York win?',yes_sub_title:'New York wins'};
  assert.ok(leadSignal(gameState(milestone,live(140,30)),market));
  assert.equal(leadSignal(gameState(milestone,live(140,30,2)),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,live_data_delayed:true}}),market),null);
  assert.equal(leadSignal(gameState(milestone,live(140,30)),{...market,title:'Will Boston win?',yes_sub_title:'Boston wins'}),null);
});
test('baseball needs two runs in the ninth and allocates 20 or 30 percent',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',custom_strike:{baseball_team:'home'},yes_sub_title:'New York'};
  const board=(inning,home=5)=>({details:{status:'inprogress',home_runs:home,away_runs:3,inning,inning_half:2,outs:1,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(m,board(8)),market),null);
  assert.equal(leadSignal(gameState(m,board(9,4)),market),null);
  assert.equal(leadSignal(gameState(m,board(9)),market)?.fraction,.2);
  assert.equal(leadSignal(gameState(m,board(9,6)),market)?.fraction,.3);
});
test('baseball accepts a two-run shutout lead',()=>{
  const baseball={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,inning)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_runs:home,away_runs:away,inning,inning_half:2,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(baseball,at(1,0,9)),market),null);
  assert.equal(leadSignal(gameState(baseball,at(2,0,9)),market)?.fraction,.2);
  assert.equal(leadSignal(gameState(baseball,at(3,0,9)),market)?.fraction,.3);
  assert.equal(leadSignal(gameState(baseball,at(2,0,8)),market),null);
});
test('hockey needs a two-goal lead in third period under seven minutes',()=>{
  const hockey={...milestone,type:'hockey_match',details:{league:'NHL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,period,clock)=>({details:{...live(home,away,period).details,clock}});
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'06:59')),market)?.fraction,.2);
  assert.equal(leadSignal(gameState(hockey,at(4,1,3,'06:59')),market)?.fraction,.3);
  assert.equal(leadSignal(gameState(hockey,at(2,0,3,'06:59')),market)?.fraction,.2);
  assert.equal(leadSignal(gameState(hockey,at(2,1,3,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,2,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'07:00')),market),null);
});
test('basketball requires five points and under seven minutes in final quarter or half',()=>{
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  for(const league of ['NBA','WNBA','Basketball']){
    const m={...milestone,details:{league}};
    const at=(home,away,quarter,clock)=>({details:{...live(home,away,quarter).details,clock}});
    assert.equal(leadSignal(gameState(m,at(104,100,4,'06:59')),market),null);
    assert.equal(leadSignal(gameState(m,at(105,100,4,'06:59')),market)?.fraction,.2);
    assert.equal(leadSignal(gameState(m,at(106,100,4,'06:59')),market)?.fraction,.3);
    assert.equal(leadSignal(gameState(m,at(105,100,4,'07:00')),market),null);
    assert.equal(leadSignal(gameState(m,at(105,100,3,'03:00')),market),null);
    assert.ok(leadSignal(gameState(m,at(5,0,4,'01:59')),market));
  }
  const college={...milestone,details:{league:'NCAAMB'}};
  assert.ok(leadSignal(gameState(college,{details:{...live(72,67,2).details,clock:'06:00'}}),market));
  assert.equal(leadSignal(gameState(college,{details:{...live(72,67,1).details,clock:'01:00'}}),market),null);
});
test('football needs a ten point lead, independent of percentage, in final seven minutes',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const board={details:{...live(24,14).details,clock:'06:00'}};
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.2);
  board.details.home_score=24;board.details.away_score=15;
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.home_score=25;board.details.away_score=14;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.3);
  board.details.home_score=100;board.details.away_score=90;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.2);
  board.details.home_score=10;board.details.away_score=0;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.2);
  board.details.home_score=24;board.details.away_score=14;board.details.clock='07:00';
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.clock='06:00';board.details.quarter=3;
  assert.equal(leadSignal(gameState(m,board),market),null);
});
test('quantity preflights cash, allocation, fees, price and displayed liquidity',()=>{
  assert.equal(orderSize(10000,'0.50','400',.8),149);
  assert.equal(orderSize(10000,'0.50','10',.8),10);
  assert.equal(orderSize(10000,'0.99','400',.8),80);
  assert.equal(orderSize(10000,'0.50',undefined,.8),0);
  assert.equal(orderSize(10000,'0.50','400',.2,1,20000),74);
  assert.equal(orderSize(10000,'0.50','400',.3,1,20000),112);
  assert.equal(orderSize(2000,'0.50','400',.3,1,20000),37);
  assert.equal(orderSize(100,'0.99','10',1),1);
  assert.equal(orderSize(99,'0.99','10',1),0);
  assert.equal(orderSize(54,'0.50','10',1),1);
  assert.equal(orderSize(53,'0.50','10',1),0);
  assert.equal(orderSize(54,'0.50','10',1,1,54,Infinity,4),0);
  assert.equal(orderSize(10000,'0.50','400',.8,1,10000,1000),18);
  assert.equal(orderSize(10000,'0.50','400',.8,.98),149);
  assert.equal(orderSize(10000,'0.99','400',.8,.98),0);
  const count=orderSize(10000,'0.50','400',.8);
  assert.ok(estimatedCostCents(count,.5)<=8000);
  assert.ok(estimatedCostCents(count+1,.5)>8000);
});
test('over allocation is capped across existing unsettled over positions',()=>{
  assert.equal(overBudget(10000,0,0),8000);
  assert.equal(overBudget(2000,8000,8000),0);
  assert.equal(overBudget(6000,4000,3000),5000);
  assert.equal(overBudget(10000,0,9000),0);
});
