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
test('NHL full-game 2.5 cushion starts at 9:00 and enters under 8:00; P3 keeps 7:00 and 5:00',()=>{
  for(const third of [false,true]){
    const quote=market(third,third?4.5:5.5);
    assert.equal(hockeyNoMarketSpec(state(third?'7:01':'9:01'),quote,{beforeWindow:true}),null);
    assert.ok(hockeyNoMarketSpec(state(third?'7:00':'9:00'),quote,{beforeWindow:true}));
    assert.equal(hockeyTotalNo(state(third?'6:00':'8:00'),quote),null);
    assert.equal(hockeyTotalNo(state(third?'5:00':'8:00'),market(third,third?2.5:5.5)),null);
    assert.ok(hockeyTotalNo(state(third?'4:59':'7:59'),market(third,third?2.5:5.5)));
    assert.equal(hockeyTotalNo(state('0:00'),market(third)),null);
  }
});
test('NHL full-game NO accepts a 2.5 cushion through four scored',()=>{
  assert.equal(hockeyTotalNo(state('4:29'),market(false,5.5))?.total,3);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,4.5)),null);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,4.0)),null);
  assert.equal(hockeyTotalNo(state('4:29'),market(false,3.5)),null);
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,7.5))?.total,4,'four scored need 3.5 cushion');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,6.5))?.total,4,'four scored with 2.5 cushion qualifies');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,5.5)),null);
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(false,4.5)),null);
});
test('NHL full-game NO 2.5 line cannot enter with two goals already scored',()=>{
 assert.equal(hockeyTotalNo(state('7:00',2,0),market(false,2.5)),null);
 assert.equal(hockeyTotalNo(state('4:00',2,0),market(false,2.5)),null);
 assert.equal(hockeyTotalNo(state('5:00',1,0),market(false,2.5)),null);
 assert.ok(hockeyTotalNo(state('4:59',1,0),market(false,2.5)));
 assert.ok(hockeyTotalNo(state('7:00',2,0),market(false,4.5)));
});
test('NHL third-period market still counts only P3 goals, not game total',()=>{
  assert.equal(hockeyTotalNo(state('4:29'),market(true,2.5))?.total,0);
  assert.equal(hockeyTotalNo(state('4:29'),market(true,1.5)),null,'1.5 only in full-game OT');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(true,3.5))?.total,1,
    'P3 counts its one goal, despite four scored across the game');
  assert.equal(hockeyTotalNo(state('4:29',3,1),market(true,2.5)),null);
});
