import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal} from '../src/strategy.mjs';
import {overTiming,overCushion,overContractKey,timedOverEntryValid} from '../src/over_verification.mjs';

const start=Date.parse('2026-11-02T12:00:00Z');
const window={initial_at:start,first_external_at:start+20000,first_external_id:'first'};
const market={ticker:'KXEPLTOTAL-TEST-T2',event_ticker:'KXEPLTOTAL-TEST',status:'active',
  floor_strike:2.5,strike_type:'greater',title:'Over 2.5 total goals',
  rules_primary:'Combined total goals scored in the full game',yes_ask_dollars:'.95'};
function state(type,at=start+150000){
  return {...gameState({id:'soccer',type,title:'Away at Home',details:{home_team_id:'home'}},
    {milestone_id:'soccer',_observed_at:new Date(at).toISOString(),details:{status:'live',
      home_score:2,away_score:1,time:"70'",half:'2nd',home_team_name:'Home',
      last_updated_ts:at/1000,player_stats:{p1:{goals:2}}}}),verifiedLive:true,
    periodScores:[{number:1,home:1,away:0},{number:2,home:1,away:1}]};
}
const contracts=[market,
  {...market,ticker:'TEAM',event_ticker:'KXEPLTEAMTOTAL-TEST',floor_strike:1.5,
    title:'Home over 1.5 total goals',custom_strike:{soccer_team:'home'}},
  {...market,ticker:'HALF',event_ticker:'KXEPL2HTOTAL-TEST',floor_strike:1.5,
    title:'Over 1.5 total goals in 2nd half'},
  {...market,ticker:'PLAYER',event_ticker:'KXSOCCERGOALS-TEST',floor_strike:1.5,
    title:'John Doe: 2+ goals',yes_sub_title:'John Doe: 2+',rules_primary:'John Doe goals',
    custom_strike:{soccer_player:'p1'}}];

test('soccer game, team, period and player overs pair at 2:30, never earlier',()=>{
  for(const type of ['soccer_match','soccer_tournament_multi_leg'])for(const contract of contracts){
    const game=state(type);
    assert.ok(overSignal(game,contract),contract.ticker);
    assert.equal(overCushion(game,contract),null,contract.ticker);
    assert.equal(overTiming({...window,first_external_at:null},game,contract,start+19999).stage,'first_wait');
    assert.equal(overTiming({...window,first_external_at:null},game,contract,start+20000).stage,'first_external');
    assert.deepEqual(overTiming(window,game,contract,start+149999),{stage:'final_wait',remainingMs:1,minimumMs:150000});
    assert.equal(overTiming(window,game,contract,start+150000).stage,'paired');
    assert.equal(overTiming(window,game,contract,start+150000).route,'elapsed');
  }
});

test('soccer dispatch proof enforces 2:30, distinct external reads, contract identity and freshness',()=>{
  const proof={contractKey:overContractKey(state('soccer_match'),market),initialAt:start,
    firstExternalAt:start+20000,firstExternalId:'first',pairedAt:start+150000,
    pairedExternalId:'second',route:'elapsed'};
  const game={...state('soccer_match'),verificationId:'aggregate',overVerification:proof};
  assert.equal(timedOverEntryValid({...game,overVerification:{...proof,pairedAt:start+149999}},market,start+150000),false);
  assert.equal(timedOverEntryValid(game,market,start+150000),true);
  assert.equal(timedOverEntryValid({...game,overVerification:{...proof,pairedExternalId:'first'}},market,start+150000),false);
  assert.equal(timedOverEntryValid({...game,overVerification:{...proof,firstExternalAt:start+19999}},market,start+150000),false);
  assert.equal(timedOverEntryValid(game,{...market,floor_strike:3.5},start+150000),false);
  assert.equal(timedOverEntryValid(game,market,start+160001),false);
});

test('other sport timers retain 3:00, including eSoccer; soccer scoring cushions remain immediate',()=>{
  for(const type of ['basketball_game','football_game','hockey_match','baseball_game','tennis_tournament_singles','esports_match']){
    const game={...state(type),sport:type==='esports_match'?'eSoccer':'Other'};
    assert.equal(overTiming(window,game,market,start+150000).stage,'final_wait');
    assert.equal(overTiming(window,game,market,start+180000).stage,'paired');
  }
  const game={...state('soccer_match'),home:3};
  assert.equal(overTiming(window,game,market,start+20000).route,'cushion');
  assert.equal(timedOverEntryValid({...game,verificationId:'seller',overVerification:{route:'seller_cushion',
    contractKey:overContractKey(game,market),sellerAt:start+150000}},market,start+150000),true);
});
