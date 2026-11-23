import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo} from '../src/no_strategy.mjs';
import {entryEventTickers,nearEntryPhase} from '../src/discovery.mjs';

const cases=[
 {sport:'NCAAB',event:'KXNCAAMB1HTOTAL-26NOV20MURRWIS',
  game:'KXNCAAMBGAME-26NOV20MURRWIS',title:'Murray St. vs Wisconsin',
  rule:'men\'s college basketball',period:1},
 {sport:'NCAAW',event:'KXNCAAWB1HTOTAL-26NOV20BAYUSC',
  game:'KXNCAAWBGAME-26NOV20BAYUSC',title:'Baylor vs USC',
  rule:'women\'s college basketball',period:2}
];
for(const config of cases){
 const milestone={id:'half-12-'+config.sport,title:config.title,type:'basketball_game',
  start_date:'2026-11-20T19:00:00Z',
  details:{league:config.sport,main_game_event_ticker:config.game}};
 const market=(line=87.5)=>({
  ticker:config.event+'-'+Math.ceil(line),event_ticker:config.event,
  title:'1st Half: Over '+line+' points scored',yes_sub_title:'Over '+line+' points',
  floor_strike:line,strike_type:'greater',status:'active',
  rules_primary:'If over '+line+' total points are scored in the 1st half of the '+
    config.title+' '+config.rule+
    ' game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'
 });
 const state=(clock='1:29',home=30,away=45)=>gameState(milestone,{
   milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{
    status:'inprogress',period:config.period,period_remaining_time:clock,
    home_score:home,away_score:away,last_updated_ts:Date.now()/1000}});
 test(config.sport+' real first-half total: 12-point cushion, 2:00 first proof, strict under 1:30 entry',()=>{
  assert.equal(collegeBasketballTotalNo(state('1:29'),market(87.5))?.total,75);
  assert.equal(collegeBasketballTotalNo(state('1:29'),market(87.0))?.total,75,
    'exact 12.0 cushion qualifies');
  assert.equal(collegeBasketballTotalNo(state('1:29'),market(86.5)),null);
  assert.equal(collegeBasketballTotalNo(state('1:30'),market(87.5)),null);
  assert.ok(collegeBasketballTotalNo(state('2:00'),market(87.5),{beforeWindow:true}));
  assert.equal(collegeBasketballTotalNo(state('2:00'),market(87.5)),null);
  assert.deepEqual(entryEventTickers(milestone,state('2:30')),[],'historical basketball contracts remain parseable but not scanned');
  assert.equal(nearEntryPhase(state('2:30')),false);
  assert.equal(collegeBasketballTotalNo(state('0:00'),market(87.5)),null);
 });
}
test('men college full-game NO requires a separate 40-point rule with an under-7:00 entry',()=>{
 const milestone={id:'college-full',title:'Away at Home',type:'basketball_game',
   details:{league:'NCAAB',main_game_event_ticker:'KXNCAAMBGAME-TEST'}};
 const market=line=>({ticker:'KXNCAAMBTOTAL-TEST-'+line,
   event_ticker:'KXNCAAMBTOTAL-TEST',status:'active',
   title:'Full Game: Over '+line+' points scored',
   yes_sub_title:'Over '+line+' points',floor_strike:line,strike_type:'greater',
   rules_primary:'If over '+line+' total points are scored in the Away vs Home college basketball game, then the market resolves to Yes.'});
 const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',period:2,clock:'1:29',home_score:70,away_score:70,last_updated_ts:Date.now()/1000}});
 assert.equal(collegeBasketballTotalNo(state,market(180))?.total,140);
 assert.equal(collegeBasketballTotalNo(state,market(179.5)),null);
 assert.equal(collegeBasketballTotalNo(state,market(152)),null);
});