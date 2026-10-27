import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal,leadSignal,orderSize} from '../src/strategy.mjs';

const milestone={id:'game-1',title:'Boston at New York',type:'basketball_game',details:{competition:'Pro Basketball (M)'},related_event_tickers:['GAME']};
const live=(home,away,quarter=4)=>({details:{status:'live',home_score:home,away_score:away,quarter,clock:'05:00',home_team_name:'New York',away_team_name:'Boston'}});
test('over requires strict threshold exceeded and whole-game contract',()=>{
  const g=gameState(milestone,live(102,101));const market={status:'active',title:'Total points in game over 203',rules_primary:'Combined total points scored in the game',strike_type:'greater',floor_strike:203};
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.8);
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('late lead requires verified live score, leader identity, and progress',()=>{
  const market={status:'active',title:'Will New York win?',yes_sub_title:'New York wins'};
  assert.ok(leadSignal(gameState(milestone,live(114,84)),market));
  assert.equal(leadSignal(gameState(milestone,live(112,84,2)),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(112,84).details,live_data_delayed:true}}),market),null);
  assert.equal(leadSignal(gameState(milestone,live(112,84)),{...market,title:'Will Boston win?',yes_sub_title:'Boston wins'}),null);
});
test('quantity respects 80% cash, price and displayed ask liquidity',()=>{
  assert.equal(orderSize(10000,'0.50','400',.8),160);
  assert.equal(orderSize(10000,'0.50','10',.8),10);
  assert.equal(orderSize(10000,'0.99','400',.8),0);
  assert.equal(orderSize(10000,'0.50',undefined,.8),0);
});
