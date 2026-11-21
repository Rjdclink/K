import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {hockeyNoMarketSpec,hockeyTotalNo} from '../src/hockey_total_no.mjs';

const fixture={id:'revised-nhl-no',title:'Away at Home',type:'hockey_match',
  start_date:'2026-11-20T20:00:00Z',
  details:{league:'NHL',main_game_event_ticker:'KXNHLGAME-TEST'}};
const state=(clock,home=2,away=1)=>gameState(fixture,{milestone_id:fixture.id,
  _observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_points:home,away_points:away,period:3,
    period_remaining_time:clock,last_updated_ts:Date.now()/1000,
    period_scores:[{number:1,home_score:1,away_score:1},
      {number:2,home_score:1,away_score:0},{number:3,home_score:home-2,away_score:away-1}]}});
const market=(third=false,line=4.5)=>({
  event_ticker:(third?'KXNHL3PTOTAL':'KXNHLTOTAL')+'-TEST',
  ticker:(third?'KXNHL3PTOTAL':'KXNHLTOTAL')+'-TEST-'+line,
  status:'active',floor_strike:line,strike_type:'greater',
  title:(third?'3rd Period: ':'Full Game: ')+'Over '+line+' goals scored',
  yes_sub_title:'Over '+line+' goals scored',
  rules_primary:'If the teams collectively score more than '+line+' goals in the '+
    (third?'3rd Period of the ':'')+'Away vs Home NHL game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'
});
test('NHL NO preflight starts exactly at 7:00 remaining and entry is strictly below 6:00',()=>{
  for(const third of [false,true]){
    assert.equal(hockeyNoMarketSpec(state('7:01'),market(third),{beforeWindow:true}),null);
    assert.ok(hockeyNoMarketSpec(state('7:00'),market(third),{beforeWindow:true}));
    assert.equal(hockeyTotalNo(state('6:00'),market(third)),null);
    assert.ok(hockeyTotalNo(state('5:59'),market(third,third?1.5:5.5)));
    assert.equal(hockeyTotalNo(state('0:00'),market(third)),null);
  }
});
test('NHL full-game NO still needs 2.5 above cumulative score',()=>{
  assert.equal(hockeyTotalNo(state('4:29'),market(false,5.5))?.total,3);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,4.5)),null);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,4.0)),null);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,3.5)),null);
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,6.5)),null,'four-goal games cannot enter NO');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,5.5)),null);
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,4.5)),null);
});
test('NHL third-period market still counts only P3 goals, not game total',()=>{
  assert.equal(hockeyTotalNo(state('4:29'),market(true,1.5))?.total,0);
  assert.equal(hockeyTotalNo(state('4:29'),market(true,1.0)),null);
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(true,2.5)),null,'four-goal games cannot enter third-period NO');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(true,1.5)),null);
});