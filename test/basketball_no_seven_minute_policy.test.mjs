import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo} from '../src/no_strategy.mjs';
import {marketEntryProximity,nearEntryPhase} from '../src/discovery.mjs';
import {readFileSync} from 'node:fs';

const prefixes={NBA:'KXNBA',WNBA:'KXWNBA',NCAAMB:'KXNCAAMB',NCAAWB:'KXNCAAWB',FIBA:'KXFIBA'};
const fixture=(league,clock,period=league==='NCAAMB'?2:4)=>{
 const prefix=prefixes[league];
 const milestone={id:'late-no-'+league,type:'basketball_game',title:'Home vs Away',
  details:{league,main_game_event_ticker:prefix+'GAME-TEST'}};
 return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'live',home_points:75,away_points:75,period,clock,
   last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
};
const market=(league,line,half=false)=>{
 const series=prefixes[league]+(half?'1H':'')+'TOTAL';
 return {ticker:series+'-TEST-'+line,event_ticker:series+'-TEST',
  title:'Over '+line+' points',floor_strike:line,status:'active',strike_type:'greater',
  rules_primary:'Resolves Yes if over '+line+' total points are scored in '+
   (half?'the 1st half of ':'')+'the Away vs Home basketball game.'};
};
test('all four domestic full-game NO leagues require exact new cushion, under 7:00 and 8:00 preflight',()=>{
 for(const [league,gap]of [['NBA',45],['WNBA',40],['NCAAMB',40],['NCAAWB',40]]){
  const good=market(league,150+gap),bad=market(league,150+gap-0.5);
  assert.equal(collegeBasketballTotalNo(fixture(league,'7:00'),good),null,league+' exactly seven');
  assert.equal(collegeBasketballTotalNo(fixture(league,'6:59'),good)?.period,'full_game',league+' under seven');
  assert.equal(collegeBasketballTotalNo(fixture(league,'6:59'),bad),null,league+' rejects inadequate margin');
  assert.equal(collegeBasketballTotalNo(fixture(league,'8:00'),good,{beforeWindow:true})?.period,'full_game',league+' first external allowed at eight');
  assert.equal(collegeBasketballTotalNo(fixture(league,'8:01'),good,{beforeWindow:true}),null,league+' not earlier');
  assert.equal(collegeBasketballTotalNo(fixture(league,'0:00'),good),null);
  const near=fixture(league,'8:00');
  assert.equal(nearEntryPhase(near),false,league+' no longer receives scanner priority');
 }
});
test('college first-half and international full-game NO unchanged by four-league expansion',()=>{
 assert.equal(collegeBasketballTotalNo(fixture('NCAAMB','1:29',1),market('NCAAMB',162,true))?.period,'first_half');
 assert.equal(collegeBasketballTotalNo(fixture('NCAAMB','6:59',1),market('NCAAMB',162,true)),null);
 assert.equal(collegeBasketballTotalNo(fixture('NCAAWB','1:29',2),market('NCAAWB',162,true))?.period,'first_half');
 const intl=market('FIBA',170);
 assert.equal(collegeBasketballTotalNo(fixture('FIBA','1:29'),intl)?.period,'full_game');
 assert.equal(collegeBasketballTotalNo(fixture('FIBA','6:59'),intl),null);
 assert.equal(collegeBasketballTotalNo(fixture('FIBA','5:00'),intl,{beforeWindow:true}),null);
});
test('scanner preserves football and first-half checkpoints while scheduling 8:00 and under 7:00 full games',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scanHockeyTotalNos('));
 assert.match(section,/initialClock=expandedFullGame\?480:/);
 assert.match(section,/entryClock=expandedFullGame\?420:/);
 assert.match(section,/initialLabel=expandedFullGame\?'8:00'/);
 assert.match(section,/const prewindow=360,entry=300/,'football starts verification before unchanged entry window');
 assert.match(section,/c\.signal\.period==='full_game'\?120:150/,'unchanged other basketball verifier');
 assert.match(section,/validNoPreflight/);
 assert.match(section,/lateNoPreflightProgress/);
});
