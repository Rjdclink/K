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
test('NBA WNBA and men college full-game NO require exact sport-specific cushions and entry strictly under 3:00',()=>{
 for(const [league,cushion] of [['NBA',26],['WNBA',25],['NCAAMB',26]]){
  const exact=market(league,140+cushion);
  assert.equal(collegeBasketballTotalNo(fixture(league,'3:00'),exact),null,league+' boundary');
  assert.equal(collegeBasketballTotalNo(fixture(league,'2:59'),exact)?.period,'full_game',league+' eligible');
  assert.equal(collegeBasketballTotalNo(fixture(league,'2:59'),market(league,140+cushion-.5)),null,league+' below cushion');
  assert.ok(collegeBasketballTotalNo(fixture(league,'4:00'),exact,{beforeWindow:true}),league+' preflight candidate');
  assert.equal(collegeBasketballTotalNo(fixture(league,'0:00'),exact),null);
 }
});
test('college first half, women college full game and international NO retain earlier thresholds',()=>{
 const collegeHalf=fixture('NCAAMB','1:29',1);
 assert.ok(collegeBasketballTotalNo(collegeHalf,market('NCAAMB',152,true)));
 assert.equal(collegeBasketballTotalNo(fixture('NCAAMB','2:59',1),market('NCAAMB',152,true)),null);
 for(const league of ['NCAAWB','FIBA']){
  assert.ok(collegeBasketballTotalNo(fixture(league,'1:29'),market(league,160)),league+' preserved 20');
  assert.equal(collegeBasketballTotalNo(fixture(league,'2:59'),market(league,160)),null,league+' preserved clock');
 }
});
