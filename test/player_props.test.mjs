import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal,playerOverSpec,playerPropEarlyWindow,cushionedOverSignal} from '../src/strategy.mjs';
import {overCushion,overContractKey} from '../src/over_verification.mjs';
import {verifiedOverFraction} from '../src/lead_allocation.mjs';
import {playerStatAgreement} from '../src/score_verification.mjs';
test('player props stop with fewer than ten minutes of regulation remaining',()=>{
  const m={id:'g',type:'basketball_game',details:{league:'NBA'}},market={event_ticker:'KXNBAPTS-TEST',status:'active',floor_strike:1.5,custom_strike:{basketball_player:'p'},yes_sub_title:'Pat: 2+',title:'Pat: 2+ points',yes_ask_dollars:'.95'};
  const state=(period,clock)=>gameState(m,{details:{status:'live',home_score:50,away_score:40,period,clock,player_stats:{p:{points:3}}}});
  assert.equal(playerPropEarlyWindow(state(4,'10:00')),true);assert.equal(overSignal(state(4,'10:00'),market)?.strategy,'over');
  assert.equal(playerPropEarlyWindow(state(4,'09:59')),false);assert.equal(overSignal(state(4,'09:59'),market),null);
  assert.equal(playerPropEarlyWindow(state(3,'00:01')),true);
  assert.equal(overSignal(state(4,''),market),null,'an unknown final-quarter clock cannot prove the ten-minute margin');
  assert.equal(playerPropEarlyWindow({type:'baseball_game',period:7}),true);
  assert.equal(playerPropEarlyWindow({type:'baseball_game',period:8}),false);
  assert.equal(playerPropEarlyWindow({type:'tennis_match'}),false);
});
test('scoreless hockey can still have an early crossed shots prop',()=>{
  const game=gameState({id:'g',type:'hockey_game'}, {details:{status:'live',home_score:0,away_score:0,period:1,clock:'12:00',player_stats:{p:{shots_on_goal:3}}}});
  const market={event_ticker:'KXNHLSOG-TEST',status:'active',floor_strike:1.5,custom_strike:{hockey_player:'p'},yes_sub_title:'Pat: 2+',title:'Pat: 2+ shots on goal',yes_ask_dollars:'.95'};
  assert.equal(overSignal(game,market)?.strategy,'over');
});

test('points prop needs a full-play cushion before the seller-only 40% route',()=>{
  const game=gameState({id:'g',type:'basketball_game',details:{league:'NBA'}},{details:{status:'live',home_score:3,away_score:0,period:1,clock:'08:00',player_stats:{p:{points:3}}}});
  const market={event_ticker:'KXNBAPTS-TEST',status:'active',floor_strike:1.5,custom_strike:{basketball_player:'p'},yes_sub_title:'Pat: 2+',title:'Pat: 2+ points',yes_ask_dollars:'.95'};
  assert.equal(overSignal(game,market)?.fraction,.15);assert.equal(overCushion(game,market),null);assert.equal(cushionedOverSignal(game,market),null);
  const comfortable={...game,playerStats:{p:{points:6}}};
  assert.equal(overSignal(comfortable,market)?.fraction,.40);assert.equal(overCushion(comfortable,market),4);
});
test('receiving yards have no fixed cushion and timed verification caps them at twenty percent',()=>{
  const now=Date.now(),game=gameState({id:'g',type:'football_game',details:{league:'NFL'}},{milestone_id:'g',_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:14,away_score:3,period:3,clock:'01:13',player_stats:{p:{receiving_yards:21}}}});
  const market={ticker:'KXNFLRECYDS-TEST-P',event_ticker:'KXNFLRECYDS-TEST',status:'active',floor_strike:14.5,custom_strike:{football_player:'p'},yes_sub_title:'Ryan Flournoy: 15+',title:'Ryan Flournoy: 15+ receiving yards',yes_ask_dollars:'.99'};
  assert.equal(overSignal(game,market)?.fraction,.15);assert.equal(overCushion(game,market),null);
  game.verificationId='final';game.overVerification={route:'elapsed',contractKey:overContractKey(game,market),initialAt:now-181000,firstExternalAt:now-160000,firstExternalId:'first',pairedAt:now-100,pairedExternalId:'second'};
  assert.equal(verifiedOverFraction(overSignal(game,market),game,market),.20);
});
test('non-basketball player overs use an exact linked player statistic and external box score',()=>{
  const game=gameState({id:'fixture',type:'soccer_match',title:'Away at Home'},
    {details:{status:'live',home_score:3,away_score:1,time:"70'",player_stats:{p1:{goals:3}}}});
  const market={event_ticker:'KXSOCCERGOALS-26OCT29GAME',status:'active',strike_type:'greater',floor_strike:1.5,
    custom_strike:{soccer_player:'p1'},yes_sub_title:'John Doe: 2+',title:'John Doe: 2+ goals',rules_primary:'John Doe goals',yes_ask_dollars:'.95'};
  const player=playerOverSpec(game,market);
  assert.equal(player?.value,3);
  assert.equal(overSignal({...game,playerStats:{p1:{goals:2}}},market)?.fraction,.15);
  assert.equal(overSignal(game,market)?.strategy,'over');
  assert.equal(playerPropEarlyWindow({...game,soccerMinute:80}),true);
  assert.equal(overSignal({...game,soccerMinute:80.1},market),null);
  assert.equal(overSignal({...game,playerStats:null},market),null);
  assert.equal(playerStatAgreement({boxscore:{players:[{statistics:[{name:'scoring',names:['G'],athletes:[{athlete:{displayName:'John Doe'},stats:['3']}]}]}]}},player),true);
  assert.equal(playerStatAgreement({boxscore:{players:[{statistics:[{name:'scoring',names:['G'],athletes:[{athlete:{displayName:'John Doe'},stats:['2']}]}]}]}},player),false);
});
