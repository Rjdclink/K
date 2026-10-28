import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleForMarkets,linkedEventTickers,gameTimeLabel,storedClockSeconds} from '../src/discovery.mjs';
import {gameState,overSignal,sportName} from '../src/strategy.mjs';

test('find game and both total families from a game-only milestone',()=>{
  const m={type:'basketball_game',related_event_tickers:['KXNBAGAME-26OCT28BOSBKN']};
  assert.deepEqual(linkedEventTickers(m),['KXNBAGAME-26OCT28BOSBKN','KXNBATOTAL-26OCT28BOSBKN','KXNBATEAMTOTAL-26OCT28BOSBKN']);
  assert.deepEqual(linkedEventTickers({...m,related_event_tickers:[...m.related_event_tickers,'KXNBATOTAL-26OCT28BOSBKN']}),['KXNBAGAME-26OCT28BOSBKN','KXNBATOTAL-26OCT28BOSBKN','KXNBATEAMTOTAL-26OCT28BOSBKN']);
});

test('retain only full game markets, primary winner and tennis match',()=>{
  const m={type:'basketball_game',related_event_tickers:['KXNBA1QGAME-DATE','KXNBASPREAD-DATE','KXNBAGAME-DATE','KXNBA1HTOTAL-DATE'],primary_event_tickers:['KXNBAGAME-DATE'],details:{main_game_event_ticker:'KXNBAGAME-DATE'}};
  assert.deepEqual(linkedEventTickers(m),['KXNBAGAME-DATE','KXNBATOTAL-DATE','KXNBATEAMTOTAL-DATE']);
  assert.deepEqual(linkedEventTickers({type:'tennis_tournament_singles',details:{main_game_event_ticker:'KXATPMATCH-DATE'}}),['KXATPMATCH-DATE']);
});

test('unsupported feeds keep the scan active but do not fetch markets',()=>{
  const board=(type)=>gameState({id:type,type,title:'Away at Home'},{details:{status:'live',home_score:9,away_score:3}});
  assert.equal(eligibleForMarkets(board('esports_match')),false);
  assert.equal(eligibleForMarkets(board('cricket_match')),false);
  assert.equal(eligibleForMarkets(board('basketball_game')),true);
  assert.equal(sportName({type:'esports_soccer_game'}),'eSoccer');
  assert.equal(gameTimeLabel(board('esports_match')),'Live clock unavailable');
  assert.equal(gameTimeLabel(board('cricket_match')),'Live clock unavailable');
  assert.equal(gameTimeLabel({...board('cricket_match'),period:2}),'Innings 2 · no countdown clock');
});

test('show verified phase and parsed clock without fabricating remaining time',()=>{
  const m={id:'a',type:'basketball_game',title:'Away at Home'};
  const state=d=>gameState(m,{details:{status:'live',home_score:73,away_score:65,...d}});
  assert.equal(gameTimeLabel(state({quarter:4,period_remaining_time:'1:07'})),'Quarter 4 · 01:07 remaining');
  assert.equal(gameTimeLabel(state({quarter:4,period_remaining_time:'00:09.20',clock_running:false})),'Quarter 4 · 00:09 paused');
  assert.equal(storedClockSeconds(9.2,false),9);
  assert.equal(storedClockSeconds(16.97,true),17);
  assert.equal(storedClockSeconds(NaN),null);
  assert.equal(gameTimeLabel(state({quarter:2,period_remaining_time:'8:22'})),'Quarter 2 · 08:22 remaining');
  assert.equal(gameTimeLabel(state({quarter:4})),'Live clock unavailable');
  assert.equal(gameTimeLabel({...state({}),status:'final'}),'Final');
  assert.equal(gameTimeLabel({type:'soccer_match',matchRemainingSeconds:44,soccerMinute:89.5}),'00:44 match time remaining');
  const over={status:'active',event_ticker:'KXNBATOTAL-DATE',title:'Combined total points over 130.5',rules_primary:'Combined total points scored in the game',floor_strike:130.5,yes_ask_dollars:'0.98'};
  assert.equal(overSignal(state({quarter:4}),over)?.strategy,'over');
  assert.equal(overSignal(state({quarter:4,period_remaining_time:'0:59'}),over)?.strategy,'over');
});

test('table tennis live set points come from period_scores with competitor orientation',()=>{
  const milestone={id:'ping',type:'table_tennis_match',title:'Priakhin Vadim vs Davlitshin Ildar'};
  const details={status:'live',competitor1_is_home:true,competitor1_overall_score:0,competitor2_overall_score:0,period_scores:[{competitor1_score:3,competitor2_score:7,number:1,type:'set'}]};
  const first=gameState(milestone,{details});
  assert.equal(first.home,3);assert.equal(first.away,7);assert.equal(first.scoreKnown,true);
  assert.equal(gameTimeLabel(first),'Set 1 · no countdown clock');
  const reversed=gameState(milestone,{details:{...details,competitor1_is_home:false}});
  assert.equal(reversed.home,7);assert.equal(reversed.away,3);
  assert.equal(eligibleForMarkets(first),false);
  const missing=gameState(milestone,{details:{status:'live',period_scores:[]}});
  assert.equal(missing.scoreKnown,false);
});

test('darts overall scores and esports phase display without an invented clock',()=>{
  const darts=gameState({id:'dart',type:'darts_match',title:'Tricole vs Lovely'},{details:{status:'live',competitor1_is_home:true,competitor1_overall_score:1,competitor2_overall_score:2,match_status:'1st set',period_scores:[]}});
  assert.equal(darts.sport,'Darts');assert.equal(darts.home,1);assert.equal(darts.away,2);
  assert.equal(gameTimeLabel(darts),'1st set · no countdown clock');
  assert.equal(eligibleForMarkets(darts),false);
  const esports=gameState({id:'esports',type:'esports_match',title:'Fede vs Eder',details:{league:'eSoccer'}},{details:{status:'live',home_score:3,away_score:3,period_unit:'half',home_periods:{period_1:3,period_2:0},away_periods:{period_1:2,period_2:1}}});
  assert.equal(gameTimeLabel(esports),'Half 2 · no live clock supplied');
  assert.equal(esports.scoreKnown,true);assert.equal(eligibleForMarkets(esports),false);
});
