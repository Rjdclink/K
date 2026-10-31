import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,cricketLeadSignal,drawSignal,earlyLeadSignal,kalshiOnlyLead} from '../src/strategy.mjs';
import {eligibleForMarkets} from '../src/discovery.mjs';

const at=Date.now();
const team=(type,league,home,away,extra={})=>{
  const m={id:'game',type,title:'Alpha vs Beta',details:{league,home_team_id:'alpha',away_team_id:'beta',main_game_event_ticker:'KXGAME-TEST'}};
  const market={status:'active',event_ticker:'KXGAME-TEST',ticker:'KXGAME-TEST-ALPHA',title:'Alpha wins',rules_primary:'If Alpha wins the match, then Yes.',custom_strike:{[type.split('_')[0]+'_team']:'alpha'},yes_ask_dollars:'0.95'};
  const state=(period,clock,homeScore=home,awayScore=away,other={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',period,clock,home_score:homeScore,away_score:awayScore,home_team_name:'Alpha',away_team_name:'Beta',...extra,...other}});
  return {m,market,state};
};
test('basketball needs 20 in the last third-quarter minute or 18 throughout the fourth quarter',()=>{
  const {market,state}=team('basketball_game','NBA',101,81);
  assert.equal(earlyLeadSignal(state(3,'00:59'),market)?.fraction,.02);
  assert.equal(earlyLeadSignal(state(3,'00:59',101,82),market),null);
  assert.equal(earlyLeadSignal(state(3,'01:00'),market),null);
  assert.equal(earlyLeadSignal(state(4,'12:00',101,83),market)?.fraction,.02);
  assert.equal(earlyLeadSignal(state(4,'11:01',101,83),market)?.fraction,.02);
  assert.equal(earlyLeadSignal(state(4,'11:00',101,83),market)?.fraction,.02);
  assert.equal(earlyLeadSignal(state(4,'03:00',101,83),market)?.fraction,.02);
  assert.equal(earlyLeadSignal(state(4,'00:00',101,83),market),null);
  assert.equal(earlyLeadSignal(state(4,'12:00',101,84),market),null);
});
test('Germany BBL 30-point winner is a Q4 signal even though a zero-sized ask cannot fill',()=>{
  const m={id:'rasta',title:'Rasta Vechta at Phoenix Hagen',type:'basketball_game',details:{league:'Germany BBL',home_team_id:'hagen',away_team_id:'rasta',main_game_event_ticker:'KXBBLGAME-26OCT301500RASHAG'}};
  const game=gameState(m,{details:{status:'live',period:4,clock:'09:26',home_score:53,away_score:83,home_team_name:'Phoenix Hagen',away_team_name:'Rasta Vechta'}});
  const market={event_ticker:m.details.main_game_event_ticker,title:'Rasta Vechta wins',status:'active',custom_strike:{basketball_team:'rasta'},yes_ask_dollars:'1.0000',yes_ask_size_fp:'0.00'};
  assert.equal(earlyLeadSignal(game,market)?.fraction,.02);
  assert.equal(Number(market.yes_ask_size_fp),0);
});
test('football uses 28 then 21, hockey four then three, and rugby is excluded',()=>{
  const football=team('football_game','NFL',28,0);
  assert.equal(earlyLeadSignal(football.state(3,'00:30'),football.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(football.state(3,'00:30',27,0),football.market),null);
  assert.equal(earlyLeadSignal(football.state(4,'15:00',21,0),football.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(football.state(4,'08:00',21,0),football.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(football.state(4,'15:00',20,0),football.market),null);
  const hockey=team('hockey_match','NHL',4,0);
  assert.equal(earlyLeadSignal(hockey.state(2,'00:30'),hockey.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(hockey.state(3,'20:00',3,0),hockey.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(hockey.state(3,'12:00',3,0),hockey.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(hockey.state(2,'00:30',3,0),hockey.market),null);
  const rugby=team('rugby_match','United Rugby Championship',50,0);
  assert.equal(earlyLeadSignal(rugby.state(1,'00:10'),rugby.market),null);
});
test('baseball needs verified inning half and outs; draw requires a real final clock and draw contract',()=>{
  const baseball=team('baseball_game','MLB',7,0);
  assert.equal(earlyLeadSignal(baseball.state(8,'',7,0,{inning:8,inning_half:'bottom',outs:2}),baseball.market)?.fraction,.02);
  assert.equal(earlyLeadSignal(baseball.state(8,'',6,0,{inning:8,inning_half:'bottom',outs:2}),baseball.market),null);
  assert.equal(earlyLeadSignal(baseball.state(9,'',5,0,{inning:9,inning_half:'top',outs:0}),baseball.market)?.fraction,.02);
  const rugby=team('rugby_match','United Rugby Championship',0,0);
  const draw={...rugby.market,title:'Draw/Tie wins',rules_primary:'If Alpha and Beta draw or tie in the professional rugby match, then the market resolves to Yes.',custom_strike:{rugby_team:'draw'}};
  assert.equal(drawSignal(rugby.state(1,'00:19'),draw),null);
  assert.equal(drawSignal(rugby.state(2,'00:20'),draw),null);
  assert.equal(drawSignal(rugby.state(2,'00:19'),draw)?.fraction,.05);
  assert.equal(drawSignal(rugby.state(2,'00:19',7,7),draw)?.fraction,.05);
  assert.equal(drawSignal(rugby.state(2,'00:19',7,0),draw),null);
  assert.equal(drawSignal(rugby.state(2,'00:19'),{...draw,title:'Alpha wins'}),null);
  const soccer=team('soccer_tournament_multi_leg','Soccer',1,1);
  const soccerDraw={...soccer.market,title:'Draw',rules_primary:'If Alpha and Beta draw in regulation plus stoppage time, then Yes.'};
  const stoppage=soccer.state(2,'',1,1,{half:'2nd',time:"90+3'",match_remaining_seconds:19,match_status:'live'});
  assert.equal(drawSignal(stoppage,soccerDraw)?.fraction,.05);
  assert.equal(drawSignal(stoppage,{...soccerDraw,title:'Tie is the result'})?.fraction,.05);
  assert.equal(drawSignal(soccer.state(2,'',1,1,{half:'2nd',time:"90+3'",match_remaining_seconds:19,match_status:'overtime'}),soccerDraw),null);
});
test('Test cricket winner entries stay disabled without a finite number of balls',()=>{
  const m={id:'test',type:'cricket_match',title:'Bangladesh vs West Indies',details:{league:'Test International (M)',home_team_id:'ban',away_team_id:'wi',main_game_event_ticker:'KXTESTMATCH-TEST'}};
  const market={status:'active',event_ticker:'KXTESTMATCH-TEST',title:'Bangladesh wins',rules_primary:'If Bangladesh wins the professional Test match, then Yes.',custom_strike:{cricket_team:'ban'},yes_ask_dollars:'0.70'};
  const board={home:'Bangladesh',away:'West Indies','Current Innings':'4','Current Batting Team':'West Indies','batting.1':'Bangladesh','batting.2':'West Indies','batting.3':'Bangladesh','batting.4':'West Indies','runs.1':'272','runs.2':'245','runs.3':'79','runs.4':'40'};
  const state=(time,innings=4,changes={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date(time).toISOString(),details:{status:'live',current_inning:innings,home_score:79,away_score:40,batting:'away',home_total_runs:351,away_total_runs:285,cricket_result:{scoreboard:{...board,'Current Innings':String(innings),...changes}}}});
  const first=state(at-12000),second=state(at);
  assert.equal(eligibleForMarkets(first),true);
  assert.deepEqual([first.cricket.homeTotal,first.cricket.awayTotal],[351,285]);
  assert.equal(cricketLeadSignal(first,market),null);
  assert.equal(kalshiOnlyLead(first,second,market),false);
  assert.equal(state(at,3).cricket,null,'third innings can still extend into a fourth');
  assert.equal(cricketLeadSignal(state(at,4,{'runs.1':'270'}),market),null);
  assert.equal(cricketLeadSignal(state(at,4,{'batting.3':'unknown'}),market),null);
  assert.equal(cricketLeadSignal(first,{...market,custom_strike:{cricket_team:'wi'}}),null);
  const d20={...m,details:{...m.details,league:'Emirates D20'}};
  const chaseBoard={home:'Dubai',away:'Emirates Blues','Current Innings':'2','Current Batting Team':'Dubai','batting.1':'Emirates Blues','batting.2':'Dubai','runs.1':'167','runs.2':'89'};
  const chase=gameState(d20,{details:{status:'live',current_inning:2,home_score:89,away_score:167,batting:'home',home_total_runs:89,away_total_runs:167,cricket_result:{scoreboard:chaseBoard}}});
  assert.equal(cricketLeadSignal(chase,{...market,custom_strike:{cricket_team:'wi'},title:'Emirates Blues wins'}),null);
});
test('limited-over cricket requires a 50-run lead, a late chase, and few wickets left',()=>{
  const m={id:'odi',type:'cricket_match',title:'UAE vs Netherlands',
    details:{league:'ODI (M)',home_team_id:'uae',away_team_id:'ned',main_game_event_ticker:'KXODIMATCH-ODI'}};
  const market={status:'active',event_ticker:'KXODIMATCH-ODI',title:'Netherlands wins',
    rules_primary:'Resolves Yes if Netherlands wins.',custom_strike:{cricket_team:'ned'},yes_ask_dollars:'0.95'};
  const board={home:'UAE',away:'Netherlands','Current Innings':'2','Current Batting Team':'UAE',
    'batting.1':'Netherlands','batting.2':'UAE','runs.1':'263','runs.2':'208',
    'wickets.2':'7','overs.2':'48.2'};
  const state=(changes={})=>gameState(m,{milestone_id:m.id,details:{status:'live',current_inning:2,
    home_score:Number(changes['runs.2']??208),away_score:263,batting:'home',
    home_total_runs:Number(changes['runs.2']??208),away_total_runs:263,
    cricket_result:{scoreboard:{...board,...changes}}}});
  assert.equal(state().cricket.ballsRemaining,10);
  assert.equal(state().cricket.wicketsRemaining,3);
  assert.equal(cricketLeadSignal(state(),market)?.fraction,.10);
  assert.equal(cricketLeadSignal(state({'runs.2':'214'}),market),null,'49 runs is below the floor');
  assert.equal(cricketLeadSignal(state({'wickets.2':'6'}),market),null,'four wickets can still bat');
  assert.equal(cricketLeadSignal(state({'overs.2':'47.5'}),market),null,'too many balls remain');
  assert.equal(cricketLeadSignal(state({'wickets.2':undefined}),market),null);
  assert.equal(cricketLeadSignal(state({'overs.2':'49.7'}),market),null,'invalid ball count fails closed');
  assert.equal(cricketLeadSignal(state(),{...market,yes_ask_dollars:'0.89'}),null,'do not buy a long shot');
  assert.equal(cricketLeadSignal(state(),{...market,custom_strike:{cricket_team:'uae'}}),null);
});
