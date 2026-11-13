import {rememberIndependentEntry} from '../src/entry_verification.mjs';
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

test('soccer game, team, period and player overs cannot bypass the extra-goal cushion after any timer',()=>{
  for(const type of ['soccer_match','soccer_tournament_multi_leg'])for(const contract of contracts){
    const game=state(type);
    assert.ok(overSignal(game,contract),contract.ticker);
    assert.equal(overCushion(game,contract),null,contract.ticker);
    for(const elapsed of [19999,20000,149999,150000,180000,600000])
      assert.equal(overTiming(window,game,contract,start+elapsed).stage,'invalid');
    const proof={contractKey:overContractKey(game,contract),initialAt:start,firstExternalAt:start+20000,
      firstExternalId:'first',pairedAt:start+150000,pairedExternalId:'second',route:'elapsed'};
    const verified={...game,verificationId:'aggregate',overVerification:proof};
    rememberIndependentEntry(verified,contract,'aggregate',start+150000,overSignal(game,contract).scored);
    assert.equal(timedOverEntryValid(verified,contract,start+150000),false);
  }
});
test('soccer cushion requires the independent extra goal and a fresh exact-contract seller proof',()=>{
  const game={...state('soccer_match'),home:3};
  assert.equal(overCushion(game,market),1);
  assert.equal(overTiming(window,game,market,start+20000).route,'cushion');
  const verified={...game,verificationId:'external',overVerification:{route:'seller_cushion',contractKey:overContractKey(game,market),sellerAt:start+150000}};
  assert.equal(timedOverEntryValid(verified,market,start+150000),false);
  for(const value of [undefined,3]){
    rememberIndependentEntry(verified,market,'external',start+150000,value);
    assert.equal(timedOverEntryValid(verified,market,start+150000),false);
  }
  rememberIndependentEntry(verified,market,'external',start+150000,4);
  assert.equal(timedOverEntryValid(verified,market,start+150000),true);
  assert.equal(timedOverEntryValid(verified,{...market,floor_strike:3.5},start+150000),false);
  assert.equal(timedOverEntryValid(verified,market,start+160001),false);
});
