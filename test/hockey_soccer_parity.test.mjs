import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {hockeyTotalNo} from '../src/hockey_total_no.mjs';
import {hockeyEarlyPeriodNo} from '../src/hockey_early_period_no.mjs';
import {noNearLossScore} from '../src/no_protective_exit.mjs';

const milestone={id:'nhl-parity',title:'Away at Home',type:'hockey_match',
  start_date:'2026-11-21T19:00:00Z',
  details:{league:'NHL',main_game_event_ticker:'KXNHLGAME-26NOV21AWAYHOME'}};
function game(period,parts,clock='1:29'){
  const home=parts.reduce((a,p)=>a+p.home,0),away=parts.reduce((a,p)=>a+p.away,0);
  return gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'inprogress',period,home_points:home,away_points:away,
      period_remaining_time:clock,last_updated_ts:Date.now()/1000,
      period_scores:parts.map(p=>({number:p.number,home_score:p.home,away_score:p.away}))}});
}
function market(segment,line){
  const series=segment==='full'?'KXNHLTOTAL':'KXNHL'+segment+'PTOTAL';
  const label=segment==='full'?'Full Game: ':segment==='1'?'1st Period: ':
    segment==='2'?'2nd Period: ':'3rd Period: ';
  const rulePeriod=segment==='full'?'':segment==='1'?'1st Period of the ':
    segment==='2'?'2nd Period of the ':'3rd Period of the ';
  return {event_ticker:series+'-26NOV21AWAYHOME',
    ticker:series+'-26NOV21AWAYHOME-'+line,status:'active',strike_type:'greater',
    floor_strike:line,title:label+'Over '+line+' goals scored',
    yes_sub_title:'Over '+line+' goals scored',
    rules_primary:'If the teams collectively score more than '+line+' goals in the '+
      rulePeriod+'Away vs Home NHL game originally scheduled for Nov 21, 2026, then the market resolves to Yes.'};
}
const p=(number,home,away)=>({number,home,away});

test('NHL full-game copies soccer NO: 2.5 cushion through three goals, 3.5 with four+',()=>{
 const three=game(3,[p(1,1,1),p(2,1,0),p(3,0,0)]);
 assert.equal(hockeyTotalNo(three,market('full',5.5))?.total,3);
 assert.equal(hockeyTotalNo(three,market('full',4.5)),null);
 const four=game(3,[p(1,1,1),p(2,1,1),p(3,0,0)]);
 assert.equal(hockeyTotalNo(four,market('full',7.5))?.total,4);
 assert.equal(hockeyTotalNo(four,market('full',6.5)),null);
 const five=game(3,[p(1,2,1),p(2,1,1),p(3,0,0)]);
 assert.equal(hockeyTotalNo(five,market('full',8.5)),null);
 assert.equal(hockeyTotalNo(five,market('full',7.5)),null);
});

test('NHL third-period uses the selected period goals, never a blanket four-goal veto',()=>{
 const four=game(3,[p(1,1,1),p(2,1,1),p(3,0,0)]);
 assert.equal(hockeyTotalNo(four,market('3',2.5))?.total,0);
 assert.equal(hockeyTotalNo(four,market('3',1.5)),null);
 const fourInThird=game(3,[p(1,0,0),p(2,0,0),p(3,3,1)]);
 assert.equal(hockeyTotalNo(fourInThird,market('3',7.5))?.total,4);
 assert.equal(hockeyTotalNo(fourInThird,market('3',6.5)),null);
});

test('NHL first and second periods receive soccer first-half 2.5/3.5 cushions',()=>{
 for(const period of [1,2]){
   const base=period===1?[]:[p(1,2,2)];
   const zero=game(period,[...base,p(period,0,0)],'2:29');
   assert.equal(hockeyEarlyPeriodNo(zero,market(String(period),2.5))?.total,0);
   assert.equal(hockeyEarlyPeriodNo(zero,market(String(period),1.5)),null);
   const four=game(period,[...base,p(period,3,1)],'2:29');
   assert.equal(hockeyEarlyPeriodNo(four,market(String(period),7.5))?.total,4);
   assert.equal(hockeyEarlyPeriodNo(four,market(String(period),6.5)),null);
 }
});

test('NHL 1.5 cushion is restricted to live full-game overtime, never P3 or shootout',()=>{
 const parts=[p(1,1,1),p(2,1,1),p(3,0,0)];
 const third=game(3,parts,'1:29'),overtime=game(4,parts,'1:29');
 assert.equal(hockeyTotalNo(third,market('full',5.5)),null);
 assert.equal(hockeyTotalNo(overtime,market('full',5.5))?.total,4);
 assert.equal(hockeyTotalNo(overtime,market('full',4.5)),null);
 assert.equal(hockeyTotalNo(overtime,market('3',2.5)),null);
 assert.equal(hockeyTotalNo(game(5,parts,'1:29'),market('full',5.5)),null);
 assert.equal(hockeyTotalNo({...overtime,verifiedLive:false},market('full',5.5)),null);
 assert.equal(hockeyTotalNo({...overtime,clockRunning:false},market('full',5.5)),null);
 assert.equal(hockeyTotalNo({...overtime,observedAt:Date.now()-12000},market('full',5.5)),null);
});

test('0.5-goal closeness exits still detect NHL full-game, third-period, and overtime NO',()=>{
 const parts=[p(1,1,1),p(2,1,0),p(3,0,0)];
 const third=game(3,parts),overtime=game(4,parts);
 assert.equal(noNearLossScore(third,market('full',3.5)),3);
 assert.equal(noNearLossScore(third,market('3',.5)),0);
 assert.equal(noNearLossScore(overtime,market('full',3.5)),3);
 assert.equal(noNearLossScore(third,market('full',4.5)),null);
});


test('paused NHL regulation periods fail closed before any NO entry',()=>{
 const p1=game(1,[p(1,0,0)],'2:29'),p3=game(3,[p(1,1,1),p(2,1,0),p(3,0,0)]);
 assert.equal(hockeyEarlyPeriodNo({...p1,clockRunning:false},market('1',2.5)),null);
 assert.equal(hockeyTotalNo({...p3,clockRunning:false},market('full',5.5)),null);
});
