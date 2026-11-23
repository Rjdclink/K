import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSofascoreEvents,loadSofascore} from '../src/sofascore.mjs';
import {fetchIndependentMatchScore,pairedExternalMatch} from '../src/independent_match_score.mjs';
import {verifyFreshEspnSoccerNo,validFreshEspnSoccerNo,pairedFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';
import {authoritativeGameState,verifiedSourceReady} from '../src/external_authority.mjs';
import {externalNoScore} from '../src/external_no_authority.mjs';
import {verifyFreshEspnHockeyNo,pairedFreshEspnHockeyNo} from '../src/hockey_espn_no.mjs';

const start=new Date(Date.now()-25*60000).toISOString();
const milestone={id:'fixture',title:'Alpha vs Beta',start_date:start,details:{league:'German Women Bundesliga'}};
const game={id:'fixture',type:'soccer_match',sport:'Soccer',home:0,away:1,
 homeName:'Alpha',awayName:'Beta',period:2,soccerMinute:87,observedAt:Date.now()-100,
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true};
const event=(more={})=>({id:123456,startTimestamp:Math.floor(Date.parse(start)/1000),
 homeTeam:{name:'Alpha'},awayTeam:{name:'Beta'},homeScore:{current:0},
 awayScore:{current:1},lastPeriod:'period2',status:{type:'inprogress'},...more});
const response=(events,age='0')=>({ok:true,headers:{get:key=>key==='age'?age:null},
 json:async()=>({events})});
const unavailable=async(url)=>url.includes('espn.com')?response([]):response([event()]);

test('Sofascore parses exact live scores and period without inventing a clock',()=>{
 const [reading]=parseSofascoreEvents({events:[event()]},'football');
 assert.deepEqual([reading.home,reading.away,reading.period,reading.live],[0,1,2,true]);
 assert.equal(Number.isNaN(reading.elapsedMinute),true);
 assert.equal(parseSofascoreEvents({events:[event({homeScore:{current:'0'}})]},'football').length,0);
});
test('ESPN absence and retry permit only one exact Sofascore fixture',async()=>{
 let espn=0,sofa=0;
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',
  fetcher:async(url,opts)=>{
   assert.equal(opts.cache,'no-store');
   if(url.includes('espn.com')){espn++;return response([])}
   sofa++;return response([event()]);
  }});
 assert.equal(espn,6);assert.equal(sofa,3);
 assert.equal(proof.source,'Sofascore');assert.equal(proof.eventId,'123456');
 assert.deepEqual(externalNoScore(game,proof),{home:0,away:1});
 const checked=authoritativeGameState(game,proof);
 assert.equal(verifiedSourceReady(checked),true);
 assert.equal(verifiedSourceReady(checked,Date.now()+16000),false);
});
test('ambiguity, wrong team, old kickoff, finished match, stale HTTP and challenge fail closed',async()=>{
 const run=events=>fetchIndependentMatchScore(game,milestone,{espnFeed:null,
  sofascoreLoad:async()=>events});
 const base=parseSofascoreEvents({events:[event()]},'football')[0];
 assert.equal(await run([{...base,homeAliases:['Wrong team']}]),null);
 assert.equal(await run([base,{...base,eventId:'999999'}]),false);
 assert.equal(await run([{...base,time:new Date(Date.now()-8*3600000).toISOString()}]),null);
 assert.equal(await run([{...base,live:false}]),false);
 assert.equal(await loadSofascore(game,milestone,{fetcher:async()=>response([event()],'30')}),null);
 assert.equal(await loadSofascore(game,milestone,{fetcher:async()=>({ok:false,status:403})}),null);
});
test('ESPN contradiction cannot be overridden by Sofascore',async()=>{
 const espn={events:[{id:'espn',date:start,competitions:[{status:{period:2,type:{state:'in'}},
  competitors:[{homeAway:'home',score:0,team:{displayName:'Alpha'}},
   {homeAway:'away',score:1,team:{displayName:'Beta'}}]}]}]};
 let fallback=0;
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',
  fetcher:async()=>({ok:true,json:async()=>espn}),
  sofascoreLoad:async()=>{fallback++;return [event()]}});
 assert.equal(proof.source,'ESPN');assert.equal(fallback,0);
 assert.equal(pairedExternalMatch(proof,{source:'Sofascore',eventId:'123456',gameId:game.id,
  home:0,away:1},game),true);
});
test('soccer NO retains two distinct fresh requests when ESPN is missing',async()=>{
 const first=await verifyFreshEspnSoccerNo(game,milestone,{fetcher:unavailable});
 const second=await verifyFreshEspnSoccerNo(game,milestone,{fetcher:unavailable});
 assert.equal(first?.source,'Sofascore');
 assert.equal(validFreshEspnSoccerNo(first,game),true);
 assert.equal(pairedFreshEspnSoccerNo(first,first,game),false);
 assert.equal(pairedFreshEspnSoccerNo(first,second,game),true);
});
test('hockey NO uses fresh Sofascore period scores after missing ESPN fixture',async()=>{
 const h={...game,type:'hockey_match',sport:'NHL',period:3,remainingSeconds:240,
  home:2,away:1,homeName:'Alpha',awayName:'Beta'};
 const boards={events:[event({lastPeriod:'period3',homeScore:{current:2,period1:1,period2:1,period3:0},
  awayScore:{current:1,period1:0,period2:1,period3:0}})]};
 const fetcher=async url=>url.includes('espn.com')?response([]):
  {ok:true,headers:new Headers({age:'0'}),json:async()=>boards};
 const a=await verifyFreshEspnHockeyNo(h,milestone,{fetcher});
 const b=await verifyFreshEspnHockeyNo(h,milestone,{fetcher});
 assert.equal(a?.source,'Sofascore');
 assert.deepEqual(a?.periods.map(p=>p.home),[1,1,0]);
 assert.equal(pairedFreshEspnHockeyNo(a,b,h),true);
});
