import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {verifyIndependentOverDecision,espnMatches} from '../src/score_verification.mjs';
import {sportradarJson} from '../src/sportradar.mjs';
import {verifyFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';

const collegeStart='2026-11-22T01:00:00Z';
const college={
 id:'college-denver',sport:'College Hockey',type:'hockey_tournament',
 home:4,away:2,period:3,homeName:'Denver',awayName:'St. Thomas',
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true
};
const collegeMilestone={id:'college-denver',type:'hockey_tournament',title:'St. Thomas at Denver',
 start_date:collegeStart,details:{league:'College Hockey'}};
const collegeMarket={ticker:'KXNCAAHGAME-TEST-DEN',event_ticker:'KXNCAAHGAME-TEST',
 title:'Denver wins',yes_sub_title:'Denver',status:'active'};
const collegeBoard={events:[{id:'401904680',date:collegeStart,competitions:[{
 status:{period:3,type:{state:'in'}},competitors:[
  {homeAway:'home',score:'4',team:{displayName:'Denver Pioneers',shortDisplayName:'Denver',name:'Pioneers'}},
  {homeAway:'away',score:'2',team:{displayName:'St. Thomas Tommies',shortDisplayName:'St. Thomas',name:'Tommies'}}
 ]}]}]};

test('NCAA men college hockey routes to the actual ESPN league instead of quota-exhausted Sportradar',async()=>{
 const urls=[];
 const result=await verifyIndependentOverDecision({...college},collegeMilestone,{
   market:collegeMarket,fetcher:async url=>{
     urls.push(url);
     assert.match(url,/site\.api\.espn\.com\/apis\/site\/v2\/sports\/hockey\/mens-college-hockey\/scoreboard/);
     return {ok:true,json:async()=>collegeBoard};
   }
 });
 assert.equal(result,true,'exact independent ESPN home/away, kickoff and live score must qualify');
 assert.ok(urls.length>=1,'at least one new live ESPN request is required');
 const main=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const start=main.indexOf('const externalSportFeeds=game=>{');
 const end=main.indexOf('// Candidate discovery',start);
 assert.ok(start>=0&&end>start);
 const context=vm.createContext({});
 vm.runInContext(main.slice(start,end),context);
 assert.equal(vm.runInContext("externalSportFeeds({sport:'College Hockey'})[0]",context),
   'hockey/mens-college-hockey','live authoritative game source must match independently audited scorer');
});

test('college hockey ESPN strictly rejects a different fixture, reversed teams, missing names and score contradictions',async()=>{
 const get=board=>verifyIndependentOverDecision({...college},collegeMilestone,{
  market:collegeMarket,fetcher:async()=>({ok:true,json:async()=>board})
 });
 assert.equal((await get(collegeBoard)),true);
 const reversed={events:collegeBoard.events.map(e=>({...e,competitions:e.competitions.map(c=>({
  ...c,competitors:c.competitors.map(p=>({...p,homeAway:p.homeAway==='home'?'away':'home'}))
 }))}))};
 assert.equal(espnMatches(reversed,college,collegeMilestone).length,0);
 assert.notEqual(await get(reversed),true,'reversed clubs cannot be independently confirmed');
 assert.notEqual(await get({events:collegeBoard.events.map(e=>({...e,date:'2026-11-19T01:00:00Z'}))}),true);
 assert.equal(await get({events:collegeBoard.events.map(e=>({...e,competitions:e.competitions.map(c=>({
   ...c,competitors:c.competitors.map(p=>p.homeAway==='home'?{...p,score:'3'}:p)
 }))}))}),true,'independently identified ESPN scores control even when the Kalshi display differs');
 assert.notEqual(await verifyIndependentOverDecision({...college,homeName:'',awayName:''},{...collegeMilestone,title:'St. Thomas vs Denver'},{
   market:collegeMarket,fetcher:async()=>({ok:true,json:async()=>collegeBoard})
 }),true,'absent Kalshi team orientation cannot be guessed from an ambiguous fixture title');
});

test('AHL and KHL do not masquerade as ESPN NHL coverage or accept unrelated live NHL scores',async()=>{
 for(const sport of ['AHL','KHL']){
  const reads=[];
  const result=await verifyIndependentOverDecision({...college,sport}, {...collegeMilestone,details:{league:sport}},{
   market:collegeMarket,fetcher:async u=>{reads.push(u);return {ok:true,json:async()=>collegeBoard}}
  });
  assert.notEqual(result,true,sport+' cannot be verified by borrowing NCAA or NHL ESPN scoreboard');
  assert.ok(!reads.some(url=>url.includes('espn.com')),sport+' has no confirmed ESPN scoreboard feed');
 }
});

test('Sportradar HTTP 429 opens shared quota cooldown and never permits an automatic repeated request',async()=>{
 const url='https://api.sportradar.com/icehockey/trial/v2/en/schedules/live/summaries.json';
 const quotaState={blockedUntil:0};
 let attempts=0;
 await assert.rejects(sportradarJson(url,{quotaState,minInterval:0,apiKey:'not-real',
  fetcher:async()=>{attempts++;return {ok:false,status:429,headers:{get:()=> '120'}};}}),/HTTP 429/);
 assert.equal(attempts,1);
 assert.ok(quotaState.blockedUntil>=Date.now()+110000,'retry-after duration must be respected');
 await assert.rejects(sportradarJson(url,{quotaState,minInterval:0,apiKey:'not-real',
  fetcher:async()=>{attempts++;throw Error('no second network request permitted')}}),/quota|cooldown|429/i);
 assert.equal(attempts,1,'a rejected provider quota must not be retried across supported sports');
});

test('soccer ESPN absence remains unavailable, while verified external scores supersede the Kalshi display',async()=>{
 const now=Date.now(),start=new Date(now-60000).toISOString();
 const milestone={id:'soccer-test',type:'soccer_match',title:'Alpha at Beta',start_date:start,details:{league:'Soccer'}};
 const game={id:'soccer-test',type:'soccer_match',sport:'Soccer',verifiedLive:true,scoreKnown:true,
  scoreConsistent:true,periodConsistent:true,period:2,home:2,away:1,homeName:'Beta',awayName:'Alpha',
  soccerMinute:83,observedAt:now-1000};
 const fetcher=async()=>({ok:true,headers:{get:()=>null},json:async()=>({events:[]})});
 assert.equal(await verifyFreshEspnSoccerNo(game,milestone,{fetcher}),null);
 assert.match(game.verificationIssue||'',/ESPN.*fixture|fixture.*ESPN/i,
   'show the operator why an unsupported soccer fixture was not externally verified');
 const wrong={events:[{id:'espn-fixture',date:start,competitions:[{
  status:{period:2,displayClock:"83'",type:{state:'in',completed:false}},
  competitors:[{homeAway:'home',score:'2',team:{displayName:'Beta'}},
    {homeAway:'away',score:'2',team:{displayName:'Alpha'}}]}]}]};
 const proof=await verifyFreshEspnSoccerNo(game,milestone,{fetcher:async()=>({
  ok:true,headers:{get:()=>null},json:async()=>wrong
 })});
 assert.equal(proof?.source,'ESPN');
 assert.deepEqual([proof?.home,proof?.away],[2,2]);
});

test('contract-bound college hockey identity safely resolves a reversed versus-title when Kalshi omits names',async()=>{
 const ambiguous={...collegeMilestone,title:'St. Thomas vs Denver'};
 const g={...college,homeName:'',awayName:'',homeTeamId:'home-denver',awayTeamId:'away-st-thomas'};
 const selected={...collegeMarket,yes_sub_title:'Denver',custom_strike:{hockey_team:'home-denver'}};
 const result=await verifyIndependentOverDecision(g,ambiguous,{market:selected,fetcher:async()=>{
  return {ok:true,json:async()=>collegeBoard};
 }});
 assert.equal(result,true,'valid selected-team UUID plus exact unique title side establishes home and away');
 for(const altered of [
  {...selected,custom_strike:{hockey_team:'unknown-id'}},
  {...selected,yes_sub_title:'Unrelated team'},
  {...selected,custom_strike:{}}
 ]){
  assert.notEqual(await verifyIndependentOverDecision({...g},ambiguous,{market:altered,
   fetcher:async()=>({ok:true,json:async()=>collegeBoard})}),true,
   'an unproven selected-team identity cannot authorize independent match confirmation');
 }
 const changed={...collegeBoard,events:collegeBoard.events.map(e=>({...e,competitions:e.competitions.map(c=>({
  ...c,competitors:c.competitors.map(p=>p.homeAway==='home'?
   {...p,team:{displayName:'Denver Colorado Rival',shortDisplayName:'Colorado Rival'}}:p)
 }))}))};
 assert.notEqual(await verifyIndependentOverDecision(g,ambiguous,{market:selected,
  fetcher:async()=>({ok:true,json:async()=>changed})}),true,'ESPN wrong home team still rejected');
});

test('soccer entry decisions report verified source coverage, final-status, score and clock blockers rather than one generic ESPN error',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const total=source.slice(source.indexOf('async function scanSoccerTotalNos('),source.indexOf('async function scanNoncushionedPlayerOvers('));
 const early=source.slice(source.indexOf('async function scanEarlyPeriodNos('),source.indexOf('async function scanSoccerTotalNos('));
 assert.match(total,/game\.verificationIssue/,'whole-game NO first ESPN check must expose exact issue');
 assert.match(total,/fresh\.verificationIssue/,'whole-game NO final ESPN check must expose exact issue');
 assert.match(early,/game\.verificationIssue/,'first-half soccer NO must expose exact issue');
});