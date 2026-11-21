import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nearEntryPhase,prioritizeMarketGames,linkedEventTickers,entryEventTickers} from '../src/discovery.mjs';
const make=(id,type,sport,period,remainingSeconds,soccerMinute)=>({milestone:{
  id,type,details:{league:sport,main_game_event_ticker:sport==='Soccer'?'KXEPLGAME-TEST':
    sport==='NHL'?'KXNHLGAME-TEST':'KX'+(sport==='NCAAB'?'NCAAMB':sport==='NCAAW'?'NCAAWB':sport)+'GAME-TEST'}},
  state:{type,sport,period,remainingSeconds,soccerMinute,verifiedLive:true,scoreKnown:true,
    homeUnits:2,awayUnits:1}});
const scenarios=[
 ['NHL P1 approaching',make('nhl1','hockey_match','NHL',1,360),
  'KXNHL1PTOTAL-TEST'],
 ['NHL P2 approaching',make('nhl2','hockey_match','NHL',2,360),
  'KXNHL2PTOTAL-TEST'],
 ['NHL P3 commanding and totals',make('nhl3','hockey_match','NHL',3,840),
  'KXNHL3PTOTAL-TEST'],
 ['Soccer first-half approaching',make('soccer1','soccer_match','Soccer',1,NaN,38),
  'KXEPL1HTOTAL-TEST'],
 ['Soccer second-half approaching',make('soccer2','soccer_match','Soccer',2,NaN,76),
  'KXEPLTOTAL-TEST'],
 ['NBA Q1 approaching',make('nba1','basketball_game','NBA',1,360),
  'KXNBA1QTOTAL-TEST'],
 ['NBA Q2 approaching',make('nba2','basketball_game','NBA',2,360),
  'KXNBA2QTOTAL-TEST'],
 ['NBA Q3 approaching',make('nba3','basketball_game','NBA',3,360),
  'KXNBA3QTOTAL-TEST'],
 ['WNBA Q1 approaching',make('wnba1','basketball_game','WNBA',1,360),
  'KXWNBA1QTOTAL-TEST'],
 ['WNBA Q2 approaching',make('wnba2','basketball_game','WNBA',2,360),
  'KXWNBA2QTOTAL-TEST'],
 ['WNBA Q3 approaching',make('wnba3','basketball_game','WNBA',3,360),
  'KXWNBA3QTOTAL-TEST'],
 ['College men first half',make('college-m1','basketball_game','NCAAB',1,480),
  'KXNCAAMB1HTOTAL-TEST'],
 ['College women first half',make('college-w1','basketball_game','NCAAW',2,480),
  'KXNCAAWB1HTOTAL-TEST'],
 ['College men full game',make('college-m2','basketball_game','NCAAB',2,480),
  'KXNCAAMBTOTAL-TEST'],
 ['College women full game',make('college-w4','basketball_game','NCAAW',4,480),
  'KXNCAAWBTOTAL-TEST'],
];
test('every early-period, total-NO and commanding window is prioritized well before preflight and still discovers exact event families',()=>{
 for(const [name,g,ticker] of scenarios){
  assert.equal(nearEntryPhase(g.state),true,name+' urgent before first proof');
  assert.ok(entryEventTickers(g.milestone,g.state).includes(ticker),name+' catalog discovery');
  const result=prioritizeMarketGames([g],{lowBudget:0});
  assert.equal(result.length,1,name+' checked even when rotating sweep disabled');
 }
});
test('normal live games receive a market catalog sweep at least once in a minute when there are at most 48',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/lowBudget:earlySweep\.length\?Math\.min\(48,marketCandidates\.length\):0/);
 const nonUrgent=Array.from({length:40},(_,i)=>make('other-'+i,'football_game','NFL',2,1000));
 const chosen=prioritizeMarketGames(nonUrgent,{lowBudget:Math.min(48,nonUrgent.length),cycle:0});
 assert.equal(chosen.length,40);
 assert.deepEqual(new Set(chosen.map(g=>g.milestone.id)),new Set(nonUrgent.map(g=>g.milestone.id)));
});
test('the scanner executes all due sport NO finals before any routine first checks or player scans',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const fragment=src.slice(src.indexOf('const events=await marketMap('),src.indexOf('await candidateTable();'));
 const first=fragment.indexOf("submitted+=await withApiPriority('preflight_final',()=>runImmediateNoFinalPass([");
 const initial=fragment.indexOf("scanCollegeTotalNos(marketGames,events,'football',null,'initial')");
 const props=fragment.indexOf('scanVariablePlayerOvers(marketGames,events,variableOverSignals)');
 assert.ok(first>=0&&initial>first&&props>initial,'due finals precede first checks and props');
 for(const required of [
  "'football',null,'final'", "'basketball',basketballNoSignals,'final'",
  "hockeyNoSignals,'final'", "hockeyNoSignals,'NHL','final'",
  "soccerNoSignals,'final'", "soccerNoSignals,'Soccer','final'",
  "basketballNoSignals,'Basketball','final'",
  "'football',null,'initial'", "'basketball',basketballNoSignals,'initial'",
  "hockeyNoSignals,'initial'", "hockeyNoSignals,'NHL','initial'",
  "soccerNoSignals,'initial'", "soccerNoSignals,'Soccer','initial'",
  "basketballNoSignals,'Basketball','initial'"
 ])assert.ok(fragment.includes(required),'missing due-final or initial path: '+required);
});

test('priority allocates limited catalog checks to games closest to preflight rather than discovery order',()=>{
 const rows=[
  make('nba-far','basketball_game','NBA',1,710),
  make('soccer-far','soccer_match','Soccer',1,NaN,35),
  make('nba-near','basketball_game','NBA',1,480),
  make('nhl-near','hockey_match','NHL',1,500),
 ];
 const selected=prioritizeMarketGames(rows,{lowBudget:2,cycle:0});
 assert.deepEqual(selected.map(g=>g.milestone.id),['nhl-near','soccer-far']);
});
test('already eligible games are checked ahead of approaching threshold games',()=>{
 const rows=[
  make('nhl-approach','hockey_match','NHL',1,310),
  make('soccer-ready','soccer_match','Soccer',1,NaN,42),
  make('nba-ready','basketball_game','NBA',2,88),
  make('nba-approach','basketball_game','NBA',3,285)
 ];
 assert.deepEqual(prioritizeMarketGames(rows,{lowBudget:0}).map(g=>g.milestone.id),
  ['nba-ready','soccer-ready','nhl-approach','nba-approach']);
});
test('rotation reserves some capacity for other games instead of starving a distant eligible sport forever',()=>{
 const rows=Array.from({length:20},(_,i)=>make('nba-'+i,'basketball_game','NBA',1,450+i*10));
 const seen=new Set();
 for(let cycle=0;cycle<20;cycle++)
  for(const g of prioritizeMarketGames(rows,{lowBudget:5,cycle}))seen.add(g.milestone.id);
 assert.equal(seen.size,20);
});