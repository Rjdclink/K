import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,minimumProfitCents,netSettlementProfitCents,profitableCount} from '../src/strategy.mjs';
import {filledOrderGateCount} from '../src/entry_floor.mjs';

const game=(period,sport='NBA',type='basketball_game')=>({type,sport,period,remainingSeconds:600,
  playerStats:{p:{points:3,receiving_yards:25,shots_on_goal:3,hits:3,goals:3}}});
const market=(family='basketball',metric='PTS')=>({ticker:'PROP',event_ticker:`KXTEST${metric}-GAME`,
  custom_strike:{[family+'_player']:'p'},floor_strike:1.5,yes_sub_title:'Pat: 2+'});
const floor=(g,m=market(),filled=0,strategy='over')=>minimumProfitCents(strategy,5000,g.type,g.remainingSeconds,filled,{game:g,market:m});

test('crossed-over floor follows the entry quarter and preserves higher filled-order tiers',()=>{
  for(const sport of ['NBA','WNBA','NCAAW','International']){
    assert.equal(floor(game(1,sport)),15);
    assert.equal(floor(game(2,sport)),10);
    assert.equal(floor(game(3,sport)),1);
    assert.equal(floor(game(4,sport)),1);
  }
  for(const sport of ['NFL','CFB']){
    assert.equal(floor(game(1,sport,'football_game'),market('football','RECYDS')),15);
    assert.equal(floor(game(2,sport,'football_game'),market('football','RECYDS')),10);
  }
  assert.equal(floor(game(2),market(),10),15);
  assert.equal(floor(game(1),market(),15),35);
  assert.equal(floor(game(2),market(),20),50);
  assert.equal(floor({type:'esports_match',sport:'eBasketball',phase:'Quarter 1'}),15);
  assert.equal(floor({type:'esports_match',sport:'eBasketball',phase:'Quarter 2'}),10);
  assert.equal(floor({type:'esports_match',sport:'eBasketball',phase:'Quarter 3'}),1);
  assert.equal(floor({...game(1),period:NaN}),15);
});

test('winners, halves, innings and hockey periods retain their own requirements',()=>{
  assert.equal(floor(game(1),{event_ticker:'KXNBATOTAL-GAME'}),15);
  assert.equal(floor(game(2),{event_ticker:'KXNBATEAMTOTAL-GAME'}),10);
  assert.equal(floor(game(2),{event_ticker:'KXNBA2QTOTAL-GAME'}),10);
  assert.equal(floor(game(1),market(),0,'lead'),1);
  assert.equal(floor(game(1,'NCAAB')),1);
  assert.equal(floor(game(2,'NCAAB')),1);
  assert.equal(floor(game(1,'NHL','hockey_match'),market('hockey','SOG')),1);
  assert.equal(floor(game(2,'MLB','baseball_game'),market('baseball','HITS')),1);
  assert.equal(floor(game(1,'Soccer','soccer_match'),market('soccer','GOALS')),1);
});

test('crossed player, game, team and period totals share the live entry-quarter floor',()=>{
  const milestone={id:'g',type:'basketball_game',details:{league:'NBA',home_team_id:'ny',away_team_id:'bos'}};
  const total={status:'active',event_ticker:'KXNBATOTAL-TEST',title:'Over 39.5 total points',
    rules_primary:'Combined total points scored in the full game',floor_strike:39.5,yes_ask_dollars:'.88'};
  const markets=[{...market(),status:'active',yes_ask_dollars:'.88'},total,
    {...total,event_ticker:'KXNBATEAMTOTAL-TEST',title:'New York over 19.5 total points',floor_strike:19.5,custom_strike:{basketball_team:'ny'}},
    {...total,event_ticker:'KXNBA1QTOTAL-TEST',title:'Over 39.5 total points in 1st quarter'}];
  for(const period of [1,2]){
    const g=gameState(milestone,{details:{status:'live',home_score:25,away_score:20,home_team_name:'New York',away_team_name:'Boston',
      period,clock:'10:00',period_scores:[{number:1,home_score:25,away_score:20}],player_stats:{p:{points:3}}}});
    for(const m of markets){
      const signal=overSignal(g,m);
      assert.equal(signal?.strategy,'over');
      assert.equal(floor(g,m),period===1?15:10);
      assert.equal(profitableCount(1,.88,2,signal.strategy,5000,g.type,g.remainingSeconds,{game:g}),period===1?0:1);
    }
  }
});

test('each purchase must meet the quarter floor after fee rounding, including exact boundaries',()=>{
  const cases=[[1,.83,15,true],[1,.84,14,false],[2,.88,10,true],[2,.89,9,false]];
  for(const [period,price,net,allowed] of cases){
    const g=game(period);
    assert.equal(netSettlementProfitCents(1,price,2),net);
    assert.equal(profitableCount(1,price,2,'over',5000,g.type,g.remainingSeconds,{game:g,market:market()}),allowed?1:0);
  }
});

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('async function withEntryProfitFloor('),source.indexOf('async function milestones('));
test('the serialized final gate blocks exchange dispatch below the per-purchase floor',async()=>{
  for(const [period,price,allowed,filled] of [[1,.83,true,0],[1,.84,false,0],[2,.88,true,0],[2,.89,false,0],[2,.88,false,10]]){
    let sends=0,released=false;
    const rows=Array.from({length:filled},(_,i)=>({market_ticker:'HELD'+i,status:'filled'}));
    const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?[{acquired:true}]:rows}),
      release:()=>{released=true}};
    const context=vm.createContext({setTimeout,minimumProfitCents,netSettlementProfitCents,filledOrderGateCount,
      pool:{connect:async()=>client},allOpenPositions:async()=>({market_positions:rows.map(r=>({ticker:r.market_ticker,position_fp:'1'}))})});
    vm.runInContext(gate,context);
    const result=await context.withEntryProfitFloor({ticker:'PROP',count:1,price,fees:2,strategy:'over',bankroll:5000,
      game:game(period),market:market()},async()=>{sends++;return 'sent'});
    assert.equal(result,allowed?'sent':null);
    assert.equal(sends,allowed?1:0);
    assert.equal(released,true);
  }
});
