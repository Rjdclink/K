import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {nearEntryPhase,linkedEventTickers} from '../src/discovery.mjs';
import {
  hockeyEarlyNoMarketSpec,hockeyEarlyPeriodNo,
  independentEarlyHockeyNoReading,verifyIndependentEarlyHockeyNo
} from '../src/hockey_early_period_no.mjs';

const milestone={id:'nhl-sea-sj',type:'hockey_match',title:'Seattle vs San Jose',
 start_date:new Date().toISOString(),related_event_tickers:['KXNHLGAME-26NOV21SEASJ'],
 details:{league:'NHL',main_game_event_ticker:'KXNHLGAME-26NOV21SEASJ'}};
const state=(period,clock='4:00',parts=period===1?
 [{number:1,home_score:0,away_score:0}]:
 [{number:1,home_score:1,away_score:1},{number:2,home_score:0,away_score:1}])=>{
 const home=parts.reduce((n,p)=>n+p.home_score,0);
 const away=parts.reduce((n,p)=>n+p.away_score,0);
 return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{
   status:'inprogress',period,period_remaining_time:clock,home_score:home,away_score:away,
   home_team_name:'Seattle',away_team_name:'San Jose',period_scores:parts,last_updated_ts:Date.now()/1000}});
};
const market=(period,line=1.5)=>({
 ticker:`KXNHL${period}PTOTAL-26NOV21SEASJ-${Math.ceil(line)}`,
 event_ticker:`KXNHL${period}PTOTAL-26NOV21SEASJ`,
 title:`${period===1?'1st':'2nd'} Period: Over ${line} goals scored`,
 yes_sub_title:`Over ${line} goals`,
 floor_strike:line,strike_type:'greater',status:'active',
 rules_primary:`If the teams collectively score more than ${line} goals in the ${period===1?'1st':'2nd'} Period of the Seattle vs San Jose NHL game originally scheduled for Nov 21, 2026, then the market resolves to Yes.`
});
const board=(period,clock,parts)=>({events:[{id:'espn-nhl-sea-sj',date:milestone.start_date,competitions:[{
  status:{period,displayClock:clock,type:{state:'in'}},
  competitors:[
    {homeAway:'home',score:String(parts.reduce((sum,p)=>sum+p.home,0)),
      team:{displayName:'Seattle'},linescores:parts.map(p=>({value:p.home}))},
    {homeAway:'away',score:String(parts.reduce((sum,p)=>sum+p.away,0)),
      team:{displayName:'San Jose'},linescores:parts.map(p=>({value:p.away}))}
  ]}]}]});
const parts=(game,period)=>game.periodScores.filter(p=>p.number<=period);
test('both NHL early-period NO markets: initial verification from 6:00, entry strictly below 5:00',()=>{
 for(const p of [1,2]){
  const m=market(p,p===2?3.5:2.5);
  assert.equal(hockeyEarlyNoMarketSpec(state(p,'6:01'),m,{beforeWindow:true}),null);
  assert.ok(hockeyEarlyNoMarketSpec(state(p,'6:00'),m,{beforeWindow:true}));
  assert.ok(hockeyEarlyNoMarketSpec(state(p,'5:00'),m,{beforeWindow:true}));
  assert.equal(hockeyEarlyPeriodNo(state(p,'5:00'),m),null);
  assert.ok(hockeyEarlyPeriodNo(state(p,'4:59'),m));
  assert.equal(hockeyEarlyPeriodNo(state(p,'0:00'),m),null);
  assert.equal(hockeyEarlyPeriodNo(state(p,'3:29'),market(3)),null);
  assert.equal(hockeyEarlyPeriodNo(state(3,'3:29'),m),null);
 }
});
test('the second-period NO cushion counts only second-period goals, not cumulative game goals',()=>{
 const p2=state(2,'3:29');
 assert.equal(p2.home+p2.away,3);
 assert.equal(hockeyEarlyPeriodNo(p2,market(2,2.5)),null,'1.5 cushion must fail');
 assert.equal(hockeyEarlyPeriodNo(p2,market(2,1.5)),null);
 assert.equal(hockeyEarlyPeriodNo(p2,market(2,3.5))?.total,1);
 assert.equal(hockeyEarlyPeriodNo(state(2,'3:29',[
  {number:1,home_score:1,away_score:0},{number:2,home_score:1,away_score:1}
 ]),market(2,4.5))?.total,2);
 assert.equal(hockeyEarlyPeriodNo(state(2,'3:29',[
  {number:1,home_score:1,away_score:0},{number:2,home_score:1,away_score:1}
 ]),market(2,3.5)),null);
});
test('NHL early-period total market requires exact series, 1st/2nd title, strike, rules, and game ticker',()=>{
 const g=state(1,'3:29'),m=market(1,1.5);
 assert.ok(hockeyEarlyNoMarketSpec(g,m));
 for(const change of [
  {event_ticker:m.event_ticker.replace('1PTOTAL','1PTEAMTOTAL')},
  {event_ticker:m.event_ticker.replace('SEASJ','BOSNYI')},
  {title:'2nd Period: Over 1.5 goals scored'},
  {title:'Full Game: Over 1.5 goals scored'},
  {floor_strike:2.5},
  {yes_sub_title:'Over 2.5 goals'},
  {rules_primary:m.rules_primary.replace('1st Period','2nd Period')},
  {rules_primary:m.rules_primary.replace('NHL game','NHL team total game')},
  {status:'closed'}
 ])assert.equal(hockeyEarlyNoMarketSpec(g,{...m,...change}),null,JSON.stringify(change));
});
test('ESPN proof validates current period linescores without requiring future periods',()=>{
 const g1=state(1,'3:29'),m1=market(1,2.5);
 const g2=state(2,'3:29'),m2=market(2,3.5);
 const score1=board(1,'3:29',[{home:0,away:0}]);
 const score2=board(2,'3:29',[{home:1,away:1},{home:0,away:1}]);
 const proof1=independentEarlyHockeyNoReading(score1,g1,milestone,m1);
 const proof2=independentEarlyHockeyNoReading(score2,g2,milestone,m2);
 assert.equal(proof1?.period,1);
 assert.equal(proof1?.currentPeriod?.home,0);
 assert.equal(proof2?.period,2);
 assert.equal(proof2?.currentPeriod?.away,1);
 assert.equal(hockeyEarlyPeriodNo(g1,m1,{external:proof1})?.total,0);
 assert.equal(hockeyEarlyPeriodNo(g2,m2,{external:proof2})?.total,1);
 assert.equal(independentEarlyHockeyNoReading(board(2,'3:29',[{home:1,away:1},{home:1,away:0}]),g2,milestone,m2)?.home,2,'independent period goals are authoritative');
 assert.equal(independentEarlyHockeyNoReading(board(2,'4:29',[{home:1,away:1},{home:0,away:1}]),g2,milestone,m2)?.away,2,
   'the ESPN clock is not an entry requirement');
 assert.equal(independentEarlyHockeyNoReading(board(1,'3:29',[{home:0,away:0}]),g2,milestone,m2),null);
 const duplicate=structuredClone(score1);duplicate.events.push({...duplicate.events[0],id:'another'});
 assert.equal(independentEarlyHockeyNoReading(duplicate,g1,milestone,m1),null);
});
test('ESPN must confirm current period goals even when Kalshi period breakdown is omitted',async()=>{
 const g=state(2,'3:29');
 const withoutParts={...g,periodScores:[]};
 const m=market(2,3.5);
 const score=board(2,'3:29',[{home:1,away:1},{home:0,away:1}]);
 let requests=[];
 const proof=await verifyIndependentEarlyHockeyNo(withoutParts,milestone,m,{fetcher:async url=>{
  requests.push(url);return {ok:true,json:async()=>score};
 }});
 assert.equal(proof?.period,2);
 assert.equal(hockeyEarlyPeriodNo(withoutParts,m,{external:proof})?.total,1);
 assert.ok(requests.every(u=>u.includes('/hockey/nhl/scoreboard')));
 assert.equal(hockeyEarlyPeriodNo(withoutParts,m),null,'never infer period goals from cumulative score');
});
test('market priority must always include first- and second-period NHL short preflight and entry windows',()=>{
 for(const p of [1,2]){
  assert.equal(nearEntryPhase(state(p,'4:30')),true);
  assert.equal(nearEntryPhase(state(p,'4:00')),true);
  assert.equal(nearEntryPhase(state(p,'3:29')),true);
  assert.equal(nearEntryPhase(state(p,'15:00')),false);
 }
 assert.ok(linkedEventTickers(milestone).includes(market(1).event_ticker));
 assert.ok(linkedEventTickers(milestone).includes(market(2).event_ticker));
});
test('NHL periods use selected-segment cushions even with four total game goals',()=>{
  const p1=state(1,'4:00',[{number:1,home_score:2,away_score:2}]),
    p2=state(2,'4:00',[{number:1,home_score:2,away_score:2},{number:2,home_score:0,away_score:0}]);
  assert.equal(hockeyEarlyPeriodNo(p1,market(1,7.5))?.total,4,'four P1 goals require 3.5');
  assert.equal(hockeyEarlyPeriodNo(p1,market(1,6.5)),null,'only 2.5 over four P1 goals');
  assert.equal(hockeyEarlyPeriodNo(p2,market(2,2.5))?.total,0,'P2 has zero goals even when game has four');
  assert.equal(hockeyEarlyPeriodNo(p2,market(2,2.5),{beforeWindow:true})?.total,0);
  const p2three=state(2,'4:00',[{number:1,home_score:1,away_score:1},{number:2,home_score:1,away_score:0}]);
  assert.equal(hockeyEarlyPeriodNo(p2three,market(2,3.5))?.total,1);
  const proof={source:'ESPN',eventId:'matched-nhl',home:2,away:2,
    periods:[{number:1,home:1,away:1},{number:2,home:1,away:1}],
    currentPeriod:{home:1,away:1}};
  assert.equal(hockeyEarlyPeriodNo(p2three,market(2,4.5),{external:proof})?.total,2,
    'external period-two score determines the independent cushion');
  assert.equal(hockeyEarlyPeriodNo(p2three,market(2,3.5),{external:proof}),null);
});