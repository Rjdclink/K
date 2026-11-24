import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {hockeyNoMarketSpec,hockeyTotalNo,independentHockeyTotalNoReading,verifyIndependentHockeyTotalNo} from '../src/hockey_total_no.mjs';

const milestone={id:'nhl-hockey-no',title:'Away at Home',type:'hockey_match',start_date:'2026-11-19T23:00:00Z',
  details:{league:'NHL',home_team_id:'home-id',away_team_id:'away-id',main_game_event_ticker:'KXNHLGAME-26NOV19AWAYHOME'}};
const game=(clock='1:29',period=3,home=2,away=1,includePeriods=true)=>{
  const details={status:'inprogress',home_points:home,away_points:away,period,period_remaining_time:clock,last_updated_ts:Date.now()/1000,
    home_team_name:'Home',away_team_name:'Away'};
  if(includePeriods)details.period_scores=[
    {number:1,home_score:1,away_score:1},{number:2,home_score:1,away_score:0},
    {number:3,home_score:home-2,away_score:away-1}
  ];
  return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),details});
};
const market=(period='full_game',line=5.5)=>({
  ticker:(period==='full_game'?'KXNHLTOTAL':'KXNHL3PTOTAL')+'-26NOV19AWAYHOME-'+line,
  event_ticker:(period==='full_game'?'KXNHLTOTAL':'KXNHL3PTOTAL')+'-26NOV19AWAYHOME',
  title:(period==='full_game'?'Full Game: ':'3rd Period: ')+'Over '+line+' goals scored',
  yes_sub_title:'Over '+line+' goals scored',floor_strike:line,strike_type:'greater',status:'active',
  rules_primary:'If the teams collectively score more than '+line+' goals in the '+
    (period==='full_game'?'Away vs Home NHL game':'3rd Period of the Away vs Home NHL game')+
    ' originally scheduled for Nov 19, 2026, then the market resolves to Yes.'
});
const scoreboard=(clock='1:29',home3=0,away3=0)=>{
  const home=2+home3,away=1+away3;
  return {events:[{id:'nhl-event',date:milestone.start_date,competitions:[{
    status:{period:3,displayClock:clock,type:{state:'in'}},
    competitors:[{homeAway:'home',team:{displayName:'Home',abbreviation:'HOM'},score:String(home),
      linescores:[{value:1},{value:1},{value:home3}]},
      {homeAway:'away',team:{displayName:'Away',abbreviation:'AWY'},score:String(away),
        linescores:[{value:1},{value:0},{value:away3}]}]
  }]}]};
};

test('NHL full-game and third-period NO require 2.5, with 3.5 after four segment goals',()=>{
  const state=game('1:29',3,2,1);
  assert.equal(hockeyTotalNo(state,market('full_game',5.5))?.total,3,'game score 3 qualifies at line 5.5');
  assert.equal(hockeyTotalNo(state,market('full_game',5.0)),null,'2.0-goal gap does not qualify');
  assert.equal(hockeyTotalNo(state,market('full_game',4.5)),null,'1.5-goal gap does not qualify');
  assert.equal(hockeyTotalNo(state,market('full_game',4.0)),null,'1.0-goal cushion fails');
  assert.equal(hockeyTotalNo(state,market('third_period',2.5))?.total,0,'third period 0 qualifies at 2.5');
  assert.equal(hockeyTotalNo(state,market('third_period',1.5)),null,'1.5 cushion is overtime full-game only');
  assert.equal(hockeyTotalNo(state,market('third_period',1.0)),null,'1.0-goal P3 cushion fails');
  assert.equal(hockeyTotalNo(game('1:29',3,3,1),market('third_period',3.5))?.total,1,'P3 only has one goal');
  assert.equal(hockeyTotalNo(game('1:29',3,3,1),market('third_period',2.5)),null,'four goals veto P3 NO');
  assert.equal(hockeyTotalNo(game('1:29',3,3,1),market('third_period',2.0)),null);
});

test('NHL example: four combined goals allow a full 2.5 cushion, but five goals veto',()=>{
  const twoGoals=gameState(milestone,{milestone_id:milestone.id,
    _observed_at:new Date().toISOString(),details:{
      status:'inprogress',home_points:1,away_points:1,period:3,
      period_remaining_time:'1:29',last_updated_ts:Date.now()/1000,
      home_team_name:'Home',away_team_name:'Away',
      period_scores:[{number:1,home_score:1,away_score:1},
        {number:2,home_score:0,away_score:0},
        {number:3,home_score:0,away_score:0}]
    }});
  assert.equal(hockeyTotalNo(twoGoals,market('full_game',4.5))?.total,2,
    '2 total game goals means minimum full-game Over 4.5');
  assert.equal(hockeyTotalNo(twoGoals,market('full_game',3.5)),null,
    'a 1.5-goal full-game cushion is insufficient');
  const atFour=game('1:29',3,3,1);
  assert.equal(hockeyTotalNo(atFour,market('full_game',7.5))?.total,4,'4 + 3.5 is safe');
  assert.equal(hockeyTotalNo(atFour,market('full_game',6.5))?.total,4,'4 + 2.5 qualifies');
  assert.equal(hockeyTotalNo(atFour,market('full_game',5.5)),null,'a 1.5-goal full-game cushion is insufficient');
  assert.equal(hockeyTotalNo(atFour,market('full_game',5.0)),null,'one goal is below 1.5');
  assert.equal(hockeyTotalNo(atFour,market('third_period',3.5))?.total,1,'P3 goal count remains one');
  assert.equal(hockeyTotalNo(atFour,market('third_period',2.5)),null,'four goals veto P3 NO');
  assert.equal(hockeyTotalNo(atFour,market('third_period',2.0)),null);
  const twoP3Goals=game('1:29',3,4,1);
  assert.equal(hockeyTotalNo(twoP3Goals,market('third_period',4.5)),null,
    'five combined game goals veto even a cushioned P3 market');
  assert.equal(hockeyTotalNo(twoP3Goals,market('third_period',3.5)),null);
  assert.equal(hockeyTotalNo(twoP3Goals,market('third_period',3.0)),null);
});

test('NHL full-game 2.5 cushion enters under 8:00, while P3 stays under 5:00',()=>{
  for(const p of ['full_game','third_period']){
    assert.ok(hockeyNoMarketSpec(game(p==='full_game'?'9:00':'7:00'),market(p,5.5),{beforeWindow:true}));
    assert.equal(hockeyNoMarketSpec(game(p==='full_game'?'9:01':'7:01'),market(p,5.5),{beforeWindow:true}),null);
    assert.equal(hockeyTotalNo(game(p==='full_game'?'8:00':'5:00'),market(p,5.5)),null);
    assert.ok(hockeyTotalNo(game(p==='full_game'?'7:59':'4:59'),market(p,5.5)));
    assert.ok(hockeyTotalNo(game('4:59'),market(p,5.5)));
    assert.ok(hockeyTotalNo(game('1:29'),market(p,5.5)));
    assert.equal(hockeyTotalNo(game('0:00'),market(p,5.5)),null);
    assert.equal(hockeyTotalNo(game('1:29',2),market(p,5.5)),null);
    assert.equal(hockeyTotalNo(game('1:29',4),market(p,5.5))?.total,
      p==='full_game'?3:undefined);
  }
});

test('NHL NO rejects mismatched titles, unsupported series, team goals and unrelated hockey leagues',()=>{
  const state=game();
  assert.equal(hockeyTotalNo(state,{...market(),title:'Full Game: Over 6.5 goals scored'}),null);
  assert.equal(hockeyTotalNo(state,{...market(),yes_sub_title:'Over 6.5 goals scored'}),null);
  assert.equal(hockeyTotalNo(state,{...market(),rules_primary:'The third period scores more than 5.5 goals'}),null);
  assert.equal(hockeyTotalNo(state,{...market(),event_ticker:'KXNHLTEAMTOTAL-26NOV19AWAYHOME'}),null);
  assert.equal(hockeyTotalNo(state,{...market('third_period'),rules_primary:market().rules_primary}),null);
  assert.equal(hockeyTotalNo({...state,sport:'AHL'},market()),null);
  assert.equal(hockeyTotalNo(state,{...market(),status:'closed'}),null);
});

test('third-period NO fails closed without period goals unless ESPN exactly verifies them',()=>{
  const state=game('1:29',3,2,1,false),p3=market('third_period',2.5);
  assert.equal(hockeyTotalNo(state,p3),null);
  const proof={source:'ESPN',eventId:'espn-nhl',home:2,away:1,period:3,seconds:89,period3:{home:0,away:0},
    periods:[{number:1,home:1,away:1},{number:2,home:1,away:0},{number:3,home:0,away:0}]};
  assert.equal(hockeyTotalNo(state,p3,{external:proof})?.total,0);
  assert.equal(hockeyTotalNo(state,p3,{external:{...proof,home:3}}),null,'external home goals must match live total');
  assert.equal(hockeyTotalNo(state,p3,{external:{...proof,period3:{home:1,away:0}}}),null,'third-period goals cannot contradict game total');
});

test('independent ESPN proof validates the correct NHL score and period breakdown without provider clock equality',async()=>{
  const state=game('1:29',3,2,1,false),p3=market('third_period',2.5);
  const board=scoreboard();
  const direct=independentHockeyTotalNoReading(board,state,milestone,p3);
  assert.equal(direct?.period3?.home,0);
  assert.equal(direct?.period3?.away,0);
  assert.equal(direct?.seconds,89);
  let urls=[];
  const fresh=await verifyIndependentHockeyTotalNo(state,milestone,p3,{fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>board}}});
  assert.equal(fresh?.eventId,'nhl-event');
  assert.ok(urls.length>0&&urls.every(url=>url.includes('/hockey/nhl/scoreboard')));
  const mismatched=structuredClone(board);mismatched.events[0].competitions[0].competitors[0].score='3';
  assert.equal(independentHockeyTotalNoReading(mismatched,state,milestone,p3),null);
  const late=scoreboard('1:02');
  assert.equal(independentHockeyTotalNoReading(late,state,milestone,p3)?.home,2,'clock discrepancies do not veto score confirmation');
  const noPeriod=structuredClone(board);noPeriod.events[0].competitions[0].competitors[0].linescores=[];
  assert.equal(independentHockeyTotalNoReading(noPeriod,state,milestone,p3),null);
});

test('full-game NHL total NO verifies full score even when direct period breakouts are absent',()=>{
  const state=game('1:29',3,2,1,false);
  const s=scoreboard();
  s.events[0].competitions[0].competitors.forEach(x=>delete x.linescores);
  const proof=independentHockeyTotalNoReading(s,state,milestone,market('full_game',5.5));
  assert.equal(proof?.home,2);
  assert.equal(proof?.away,1);
});
test('NHL four-plus goals permit NO only with the required segment cushion',()=>{
  const atThree=game('1:29',3,2,1),atFour=game('1:29',3,3,1),atFive=game('1:29',3,4,1);
  const full=market('full_game',8.5),third=market('third_period',5.5);
  assert.equal(hockeyTotalNo(atThree,full)?.total,3);
  assert.equal(hockeyTotalNo(atThree,third)?.total,0);
  for(const state of [atFour]){
    assert.equal(hockeyTotalNo(state,full)?.total,state.home+state.away);
    assert.equal(hockeyTotalNo(state,third)?.total,state.home-2);
    assert.equal(hockeyTotalNo(state,full,{beforeWindow:true})?.total,state.home+state.away);
  }
  assert.equal(hockeyTotalNo(atFive,full)?.total,5);
  assert.equal(hockeyTotalNo(atFive,third),null);
  const reading={source:'ESPN',eventId:'nhl-match',home:3,away:1,
    periods:[{number:1,home:1,away:1},{number:2,home:1,away:0},{number:3,home:1,away:0}],
    period3:{home:1,away:0}};
  assert.equal(hockeyTotalNo(atThree,market('full_game',6.5))?.total,3);
  assert.equal(hockeyTotalNo(atThree,market('full_game',6.5),{external:reading})?.total,4,
    'verified four-goal score still has a full 2.5 cushion');
  assert.equal(hockeyTotalNo(atThree,market('third_period',2.5))?.total,0);
  assert.equal(hockeyTotalNo(atThree,market('third_period',2.5),{external:reading}),null,
    'independently attributed period-three goal increases selected score');
});
