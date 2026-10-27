import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal,leadSignal,orderSize,overBudget,touchdownsFromPbp} from '../src/strategy.mjs';

const milestone={id:'game-1',title:'Boston at New York',type:'basketball_game',details:{competition:'Pro Basketball (M)'},related_event_tickers:['GAME']};
const live=(home,away,quarter=4)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_score:home,away_score:away,quarter,clock:'05:00',home_team_name:'New York',away_team_name:'Boston'}});
test('over requires strict threshold exceeded and whole-game contract',()=>{
  const g=gameState(milestone,live(102,101));const market={status:'active',title:'Total points in game over 203',rules_primary:'Combined total points scored in the game',strike_type:'greater',floor_strike:203};
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.8);
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('late lead requires verified live score, leader identity, and progress',()=>{
  const market={status:'active',title:'Will New York win?',yes_sub_title:'New York wins'};
  assert.ok(leadSignal(gameState(milestone,live(140,30)),market));
  assert.equal(leadSignal(gameState(milestone,live(140,30,2)),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,live_data_delayed:true}}),market),null);
  assert.equal(leadSignal(gameState(milestone,live(140,30)),{...market,title:'Will Boston win?',yes_sub_title:'Boston wins'}),null);
});
test('commanding lead is only in final segment and scales across allocation tiers',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',custom_strike:{baseball_team:'home'},yes_sub_title:'New York'};
  const board=inning=>({details:{status:'inprogress',home_runs:11,away_runs:3,inning,inning_half:2,outs:1,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(m,board(8)),market),null);
  const ninth=leadSignal(gameState(m,board(9)),market);assert.ok(ninth);assert.ok(ninth.fraction>=.3 && ninth.fraction<=.55);
});
test('250% advantage means 3.5x, and seven minutes is exclusive',()=>{
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,clock)=>({details:{...live(home,away).details,clock}});
  assert.equal(leadSignal(gameState(milestone,at(34,10,'06:59')),market),null);
  assert.ok(leadSignal(gameState(milestone,at(35,10,'06:59')),market));
  assert.equal(leadSignal(gameState(milestone,at(35,10,'07:00')),market),null);
  assert.equal(leadSignal(gameState(milestone,at(20,0,'01:30')),market),null);
});
test('football lead uses confirmed touchdowns, never points as a proxy',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const board={details:{...live(42,7).details,clock:'06:00'}};
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.home_touchdowns=7;board.details.away_touchdowns=2;
  assert.ok(leadSignal(gameState(m,board),market));
});
test('football play-by-play counts touchdown scoring plays once and requires score parity',()=>{
  const pbp={periods:[{events:[{plays:[
    {play_id:'p2',sequence:2,home_points:7,away_points:0,description:'Extra point is good'},
    {play_id:'p1',sequence:1,home_points:6,away_points:0,description:'Touchdown on a rush'},
    {play_id:'p3',sequence:3,home_points:7,away_points:6,description:'Interception return TOUCHDOWN'},
    {play_id:'p3',sequence:3,home_points:7,away_points:6,description:'Interception return TOUCHDOWN'}
  ]}]}]};
  assert.deepEqual(touchdownsFromPbp(pbp,7,6),{home:1,away:1});
  assert.equal(touchdownsFromPbp(pbp,14,6),null);
});
test('quantity respects 80% cash, price and displayed ask liquidity',()=>{
  assert.equal(orderSize(10000,'0.50','400',.8),160);
  assert.equal(orderSize(10000,'0.50','10',.8),10);
  assert.equal(orderSize(10000,'0.99','400',.8),0);
  assert.equal(orderSize(10000,'0.50',undefined,.8),0);
});
test('over allocation is capped across existing unsettled over positions',()=>{
  assert.equal(overBudget(10000,0,0),8000);
  assert.equal(overBudget(2000,8000,8000),0);
  assert.equal(overBudget(6000,4000,3000),5000);
  assert.equal(overBudget(10000,0,9000),0);
});
