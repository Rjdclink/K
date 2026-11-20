import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo} from '../src/no_strategy.mjs';

const prefixes={NBA:'KXNBA',WNBA:'KXWNBA',NCAAMB:'KXNCAAMB',NCAAWB:'KXNCAAWB',FIBA:'KXFIBA'};
function fixture(league,clock='2:59',period=league==='NCAAMB'?2:4){
  const prefix=prefixes[league],milestone={id:'no-'+league,type:'basketball_game',
    title:'Away at Home',start_date:'2026-11-20T18:00:00Z',
    details:{league,main_game_event_ticker:prefix+'GAME-TEST'}};
  return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'live',home_points:70,away_points:70,period,clock,
      last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
}
function market(league,line,half=false){
 const prefix=prefixes[league]+(half?'1H':'')+'TOTAL';
 return {ticker:prefix+'-TEST-'+line,event_ticker:prefix+'-TEST',status:'active',
   title:'Over '+line+' points',floor_strike:line,strike_type:'greater',
   rules_primary:'If over '+line+' total points are scored in '+
      (half?'the 1st half of ':'')+'the Away vs Home basketball game.'};
}
test('NBA and all three women/college full-game NO thresholds use 8:00 preflight and strictly under 7:00',()=>{
 for(const [league,cushion] of [['NBA',45],['WNBA',40],['NCAAMB',40],['NCAAWB',40]]){
  const exact=market(league,140+cushion);
  assert.equal(collegeBasketballTotalNo(fixture(league,'7:00'),exact),null,league+' boundary');
  assert.equal(collegeBasketballTotalNo(fixture(league,'6:59'),exact)?.period,'full_game',league+' eligible');
  assert.equal(collegeBasketballTotalNo(fixture(league,'6:59'),market(league,140+cushion-.5)),null,league+' below cushion');
  assert.ok(collegeBasketballTotalNo(fixture(league,'8:00'),exact,{beforeWindow:true}),league+' first ESPN at eight');
  assert.equal(collegeBasketballTotalNo(fixture(league,'8:01'),exact,{beforeWindow:true}),null,league+' before first check');
  assert.equal(collegeBasketballTotalNo(fixture(league,'0:00'),exact),null);
 }
});
test('college first-half and international full-game NO retain earlier thresholds',()=>{
 assert.ok(collegeBasketballTotalNo(fixture('NCAAMB','1:29',1),market('NCAAMB',152,true)));
 assert.ok(collegeBasketballTotalNo(fixture('NCAAWB','1:29',2),market('NCAAWB',152,true)));
 assert.equal(collegeBasketballTotalNo(fixture('NCAAMB','2:59',1),market('NCAAMB',152,true)),null);
 assert.equal(collegeBasketballTotalNo(fixture('NCAAWB','2:59',2),market('NCAAWB',152,true)),null);
 assert.ok(collegeBasketballTotalNo(fixture('FIBA','1:29'),market('FIBA',160)));
 assert.equal(collegeBasketballTotalNo(fixture('FIBA','2:59'),market('FIBA',160)),null);
});
