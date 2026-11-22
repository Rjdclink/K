import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {espnMatches,scoreAgreement} from '../src/score_verification.mjs';
import {soccerTotalNo,independentSoccerTotalNoReading} from '../src/soccer_total_no.mjs';
import {hockeyTotalNo,independentHockeyTotalNoReading} from '../src/hockey_total_no.mjs';
import {basketballEarlyQuarterNo,independentBasketballEarlyQuarterNoReading} from '../src/basketball_early_quarter_no.mjs';
import {independentCollegeTotalNoReading} from '../src/college_total_no.mjs';
const start=new Date(Date.now()-60*60000).toISOString();
const milestone=(id,type,league,main)=>({id,type,title:'Alpha vs Beta',start_date:start,details:{league,main_game_event_ticker:main}});
const scoreboard=(p,clock,home,away,periods=null)=>({events:[{id:'espn-game-'+p,date:start,
  competitions:[{status:{period:p,displayClock:clock,type:{state:'in'}},competitors:[
    {homeAway:'home',team:{displayName:'Alpha'},score:String(home),...(periods?{linescores:periods.map(v=>({value:v[0]}))}:{})},
    {homeAway:'away',team:{displayName:'Beta'},score:String(away),...(periods?{linescores:periods.map(v=>({value:v[1]}))}:{})}
  ]}]}]});
const game=(m,details)=>gameState(m,{milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status:'live',home_team_name:'Alpha',away_team_name:'Beta',last_updated_ts:Date.now()/1000,...details}});

test('soccer NO external matching depends on the two teams and scores, never the external clock',()=>{
 const m=milestone('soccer-score','soccer_match','Soccer','KXEPLGAME-26NOV20ALPBET');
 const g=game(m,{home_score:2,away_score:1,period:2,half:'2nd',time:"84:00'"});
 const market={ticker:'KXEPLTOTAL-26NOV20ALPBET-6',event_ticker:'KXEPLTOTAL-26NOV20ALPBET',status:'active',strike_type:'greater',
  title:'Will over 5.5 goals be scored?',yes_sub_title:'Over 5.5 goals scored',floor_strike:5.5,
  rules_primary:'If over 5.5 goals are scored in the Alpha vs Beta professional EPL soccer game originally scheduled for Nov 20, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};
 assert.equal(soccerTotalNo(g,market,{beforeWindow:true})?.total,3);
 const oldClock=scoreboard(2,"72'",2,1);
 const reading=independentSoccerTotalNoReading(oldClock,g,m,market);
 assert.equal(reading?.home,2,'only score and correct teams required');
 assert.equal(soccerTotalNo(g,market,{beforeWindow:true,external:reading})?.total,3);
 assert.equal(independentSoccerTotalNoReading(scoreboard(2,"84'",2,2),g,m,market)?.away,2,'external goals are authoritative');
 const wrong=structuredClone(oldClock);wrong.events[0].competitions[0].competitors[0].team.displayName='Other';
 assert.equal(independentSoccerTotalNoReading(wrong,g,m,market),null,'wrong team blocked');
});

test('hockey full-game NO score proof does not require ESPN countdown to match Kalshi',()=>{
 const m=milestone('nhl-score','hockey_match','NHL','KXNHLGAME-26NOV20ALPBET');
 const g=game(m,{period:3,period_remaining_time:'4:29',home_score:2,away_score:1,
  period_scores:[{number:1,home_score:1,away_score:1},{number:2,home_score:1,away_score:0},{number:3,home_score:0,away_score:0}]});
 const market={ticker:'KXNHLTOTAL-26NOV20ALPBET-6',event_ticker:'KXNHLTOTAL-26NOV20ALPBET',title:'Full Game: Over 5.5 goals scored',
  yes_sub_title:'Over 5.5 goals',floor_strike:5.5,strike_type:'greater',status:'active',
  rules_primary:'If the teams collectively score more than 5.5 goals in the Alpha vs Beta NHL game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'};
 const proof=independentHockeyTotalNoReading(scoreboard(3,'14:00',2,1,[[1,1],[1,0],[0,0]]),g,m,market);
 assert.equal(proof?.home,2);
 assert.equal(hockeyTotalNo(g,market,{external:proof})?.total,3);
 assert.equal(independentHockeyTotalNoReading(scoreboard(3,'4:29',2,3,[[1,1],[0,1],[1,1]]),g,m,market)?.home,2);
});

test('basketball quarter-NO proof verifies the same score and attributed quarter points, not ESPN seconds',()=>{
 const m=milestone('nba-score','basketball_game','NBA','KXNBAGAME-26NOV20ALPBET');
 const g=game(m,{period:2,clock:'1:29',home_score:40,away_score:37,
  period_scores:[{number:1,home_score:25,away_score:22},{number:2,home_score:15,away_score:15}]});
 const market={ticker:'KXNBA2QTOTAL-26NOV20ALPBET-43',event_ticker:'KXNBA2QTOTAL-26NOV20ALPBET',title:'2nd Quarter: Over 42.5 points scored',
  yes_sub_title:'Over 42.5 points',floor_strike:42.5,strike_type:'greater',status:'active',
  rules_primary:'If over 42.5 total points are scored in the 2nd quarter of the Alpha vs Beta Pro Basketball game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'};
 const proof=independentBasketballEarlyQuarterNoReading(scoreboard(2,'9:30',40,37,[[25,22],[15,15]]),g,m,market);
 assert.equal(proof?.home,40);
 assert.equal(basketballEarlyQuarterNo(g,market,{external:proof})?.total,30);
});

test('football independently reported points clear only the contract line, regardless of Kalshi clock or score',()=>{
 const m=milestone('nfl-score','football_game','NFL','KXNFLGAME-26NOV20ALPBET');
 const g=game(m,{period:4,clock:'0:40',home_score:31,away_score:17});
 const contract={event_ticker:'KXNFLTOTAL-TEST',floor_strike:47.5};
 const original=espnMatches(scoreboard(4,'12:00',31,17),g,m);
 assert.equal(original.length,1);
 assert.equal(scoreAgreement(g,[original],contract),true);
 assert.equal(scoreAgreement(g,[espnMatches(scoreboard(4,'0:40',30,17),g,m)],contract),false);
});