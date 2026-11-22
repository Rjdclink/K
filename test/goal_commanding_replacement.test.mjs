import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,goalCommandingLeadEntry,leadSignal,leadWatchReason,endWindow,soccerWinnerWindowOpen} from '../src/strategy.mjs';
import {nearEntryPhase} from '../src/discovery.mjs';
import {directLeadFraction,finalLeadFraction,leadEntryFraction,minimumThreeGoalSpend,independentlyVerifiedLeadFraction} from '../src/lead_allocation.mjs';

const fixture=(type,clock,lead=3,period=null,other={})=>{
 const soccer=type==='soccer_match',id=soccer?'soccer-lead':'nhl-lead',league=soccer?'Soccer':'NHL';
 const m={id,type,title:'Away at Home',details:{league,home_team_id:'home',away_team_id:'away',main_game_event_ticker:soccer?'KXEPLGAME-TEST':'KXNHLGAME-TEST'}};
 const d={status:'live',home_score:lead,away_score:0,period:soccer?2:3,half:soccer?'2nd':undefined,home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000,
  ...(soccer?{time:clock}:{period_remaining_time:clock}),...other};
 const g=gameState(m,{milestone_id:id,_observed_at:new Date().toISOString(),details:d});
 const market={ticker:(soccer?'KXEPLGAME':'KXNHLGAME')+'-TEST-HOME',event_ticker:(soccer?'KXEPLGAME':'KXNHLGAME')+'-TEST',title:'Home wins',yes_sub_title:'Home',status:'active',custom_strike:{[soccer?'soccer_team':'hockey_team']:'home'},rules_primary:'Home wins after 90 minutes plus stoppage time.'};
 return {g,market};
};
test('NHL winner tiers allow five goals in last five minutes of P2, four from P3 start, three under 15:00, two under 6:00',()=>{
 for(const [clock,margin,allowed] of [['20:00',4,true],['20:00',3,false],
  ['15:00',3,false],['14:59',3,true],['10:01',3,true],['9:59',3,true],
  ['6:00',2,false],['5:59',2,true],['4:00',2,true],
  ['10:00',5,true],['5:59',1,false],['0:00',3,false]]){
  const {g,market}=fixture('hockey_match',clock,margin);
  assert.equal(Boolean(goalCommandingLeadEntry(g)),allowed,clock+' +'+margin);
  assert.equal(Boolean(leadSignal(g,market)),allowed,'winner signal '+clock+' +'+margin);
  assert.equal(endWindow(g),allowed,'endWindow '+clock+' +'+margin);
 }
 assert.equal(leadSignal(fixture('hockey_match','9:59',3,3,{period:2}).g,fixture('hockey_match','9:59',3).market),null);
 assert.equal(nearEntryPhase(fixture('hockey_match','11:00',3).g),true,'urgent scan starts before 10:00');
 assert.match(leadWatchReason(fixture('hockey_match','6:00',5,2,{period:2}).g),/5:00 or less left in P2/);
 assert.match(leadWatchReason(fixture('hockey_match','20:00',4).g),/start of P3/);
 assert.match(leadWatchReason(fixture('hockey_match','9:59',3).g),/15:00/);
 assert.match(leadWatchReason(fixture('hockey_match','5:59',2).g),/6:00/);
});
test('soccer commanding lead permits +5 at 25:00, +4 under 20:00, +3 under 15:00, +2 under 6:00, without invented stoppage',()=>{
 for(const [clock,margin,allowed] of [["64:59'",5,false],["65:00'",5,true],["65:01'",5,true],["65:00'",6,true],["69:59'",4,false],["70:00'",4,false],["70:01'",4,true],["74:59'",3,false],["75:00'",3,false],["75:01'",3,true],["84'",2,false],["84:01'",2,true],["86'",2,true],["90'",4,false],["93'",4,false],["83'",1,false]]){
  const {g,market}=fixture('soccer_match',clock,margin);
  assert.equal(Boolean(goalCommandingLeadEntry(g)),allowed,clock+' +'+margin);
  assert.equal(Boolean(leadSignal(g,market)),allowed,'winner signal '+clock+' +'+margin);
  assert.equal(endWindow(g),allowed,'endWindow '+clock+' +'+margin);
  assert.equal(soccerWinnerWindowOpen(g),margin<2||allowed && (90-g.soccerMinute)*60>5,'dispatch '+clock+' +'+margin);
 }
 assert.match(leadWatchReason(fixture('soccer_match',"64:00'",5).g),/25:00/);
 assert.match(leadWatchReason(fixture('soccer_match',"65:00'",5).g),/late winner rule reached/);
 assert.match(leadWatchReason(fixture('soccer_match',"69:00'",4).g),/20:00/);
 assert.match(leadWatchReason(fixture('soccer_match',"74:00'",3).g),/15:00/);
 assert.match(leadWatchReason(fixture('soccer_match',"75:01'",3).g),/late winner rule reached/);
 assert.match(leadWatchReason(fixture('soccer_match',"84:01'",2).g),/6:00/);
});
test('all hockey and soccer commanding winner allocation paths cap at 15% with zero purchase minimum',()=>{
 for(const [type,clock,margin] of [['hockey_match','9:59',3],['hockey_match','5:59',2],['soccer_match',"80:01'",3],['soccer_match',"84:01'",2]]){
  const {g,market}=fixture(type,clock,margin);
  const signal=leadSignal(g,market);assert.ok(signal);
  assert.equal(signal.fraction,.05,type+' initial signal allocation');
  assert.equal(directLeadFraction(g,signal,market),.05,type+' direct allocation');
  assert.equal(finalLeadFraction(g,g,signal,true,market),.15,type+' independently verified allocation');
  assert.equal(finalLeadFraction(g,g,signal,false,market),.05,type+' Kalshi-only allocation');
  assert.equal(leadEntryFraction(g,g,signal,market,true,false),.15,type+' final verified fraction');
  assert.equal(leadEntryFraction(g,g,signal,market,null,true),.05,type+' final direct fraction');
  assert.equal(independentlyVerifiedLeadFraction(g,market),.15);
  assert.equal(minimumThreeGoalSpend(g,signal,market,10000),0,'no contradictory 15% spend floor');
 }
});