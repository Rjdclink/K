import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFreshEspnSoccerNo,validFreshEspnSoccerNo,pairedFreshEspnSoccerNo,SOCCER_ESPN_POLICY} from '../src/soccer_espn_no.mjs';
const start=new Date(Date.now()-90*60000).toISOString();
const milestone={id:'soccer-espn',type:'soccer_match',title:'Alpha vs Beta',start_date:start,details:{league:'League'}};
const game=(minute=83,home=2,away=1,period=2)=>({id:milestone.id,type:'soccer_match',sport:'Soccer',
 home,away,homeName:'Alpha',awayName:'Beta',period,soccerMinute:minute,verifiedLive:true,
 clockRunning:true,observedAt:Date.now()-100,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
 matchRemainingSeconds:Math.max(0,(90-minute)*60)});
const scoreboard=(minute="83'",h=2,a=1,state='in',period=2)=>({events:[{id:'espn-real-id',date:start,
 competitions:[{status:{period,displayClock:minute,type:{state,completed:state==='post'}},
 competitors:[{homeAway:'home',score:String(h),team:{displayName:'Alpha'}},
 {homeAway:'away',score:String(a),team:{displayName:'Beta'}}]}]}]});
const fetcher=(board,age=0)=>async(url,options)=>{assert.match(url,/site.api.espn.com/);
 assert.equal(options.cache,'no-store');
 return {ok:true,headers:{get:n=>n.toLowerCase()==='age'?String(age):null},json:async()=>board};};
const verify=(g,b,age=0)=>verifyFreshEspnSoccerNo(g,milestone,{fetcher:fetcher(b,age)});
test('one fresh ESPN reading verifies the exact fixture, score, current period and match minute',async()=>{
 const g=game(),p=await verify(g,scoreboard());
 assert.equal(p?.source,'ESPN');
 assert.equal(p?.eventId,'espn-real-id');
 assert.equal(p?.gameId,g.id);
 assert.equal(p?.home,2);assert.equal(p?.away,1);
 assert.equal(p?.elapsedMinute,83);
 assert.equal(validFreshEspnSoccerNo(p,g),true);
 assert.equal(validFreshEspnSoccerNo(p,g,Date.now()+16000),false);
});
test('ESPN independently sourced clock is authoritative even if Kalshi shows another minute',async()=>{
 const proof=await verify(game(),scoreboard("78'"));
 assert.equal(proof?.elapsedMinute,78);
 assert.equal(validFreshEspnSoccerNo(proof,game()),true);
});
test('the correctly identified ESPN fixture controls scores despite a differing Kalshi score',async()=>{
 const twoTwo=await verify(game(),scoreboard("83'",2,2));
 const oneOne=await verify(game(),scoreboard("83'",1,1));
 assert.deepEqual([twoTwo?.home,twoTwo?.away],[2,2]);
 assert.deepEqual([oneOne?.home,oneOne?.away],[1,1]);
});
test('finished match or mismatched period cannot verify NO even with matching score',async()=>{
 assert.equal(await verify(game(),scoreboard("83'",2,1,'post')),false);
 assert.equal(await verify(game(),scoreboard("83'",2,1,'in',1)),false);
});
test('stale HTTP CDN score responses must be rejected',async()=>{
 assert.equal(await verify(game(),scoreboard(),40),false);
});
test('missing and malformed ESPN clocks fail closed instead of using request time',async()=>{
 assert.equal(await verify(game(),scoreboard('garbled')),false);
 assert.equal(await verify(game(),scoreboard('')),false);
});
test('90-plus stoppage score can verify from ESPN apostrophe plus syntax',async()=>{
 const g=game(94),p=await verify(g,scoreboard("90'+4'"));
 assert.equal(p?.elapsedMinute,94);
 assert.equal(validFreshEspnSoccerNo(p,g),true);
 assert.equal((await verify(g,scoreboard('90+1')))?.elapsedMinute,91);
});
test('first-half requires first-half ESPN status with a matching score and minute',async()=>{
 const g=game(42,0,1,1);
 assert.equal((await verify(g,scoreboard("42'",0,1,'in',1)))?.period,1);
 assert.equal(await verify(g,scoreboard("42'",0,1,'in',2)),false);
});
test('two separately requested ESPN proofs are required; proof does not authorize use after age expiry',async()=>{
 const g=game(),proof=await verify(g,scoreboard());
 const later=await verify(g,scoreboard());
 assert.equal(validFreshEspnSoccerNo(proof,g),true);
 assert.equal(validFreshEspnSoccerNo(later,g),true);
 assert.equal(validFreshEspnSoccerNo(proof,g,Date.now()+16000),false);
 assert.equal(validFreshEspnSoccerNo(proof,g,Date.now()+12000,{allowHistorical:true}),true);
});
test('legacy proofs and forged ESPN origin cannot authorize new entries',()=>{
 const g=game(),p={source:'ESPN',eventId:'id',gameId:g.id,home:2,away:1,period:2,
 live:true,elapsedMinute:83,checkedAt:Date.now()};
 assert.equal(validFreshEspnSoccerNo(p,g),false);
 assert.equal(validFreshEspnSoccerNo({...p,verificationPolicy:SOCCER_ESPN_POLICY,source:'FOX Sports'},g),false);
});

test('two ESPN checks always make separate cache-busted HTTP requests and cannot accept the same result twice',async()=>{
 const urls=[],g=game();
 const fetcher=async(url,opts)=>{
  urls.push({url,opts});
  return {ok:true,headers:{get:n=>n.toLowerCase()==='age'?'0':null},
   json:async()=>scoreboard()};
 };
 const first=await verifyFreshEspnSoccerNo(g,milestone,{fetcher});
 const second=await verifyFreshEspnSoccerNo(g,milestone,{fetcher});
 assert.equal(first?.source,'ESPN');
 assert.equal(second?.source,'ESPN');
 assert.equal(urls.length,6);
 assert.ok(urls.every(x=>x.opts.cache==='no-store'&&x.opts.headers['cache-control']==='no-cache'));
 assert.ok(urls.slice(0,3).every((x,i)=>x.url!==urls[i+3].url),'each check needs its own cache-busting URL');
 assert.notEqual(first.requestId,second.requestId);
 assert.equal(pairedFreshEspnSoccerNo(first,first,g),false);
 assert.equal(pairedFreshEspnSoccerNo(first,second,g),true);
});
test('a legacy ESPN response without independent request identity must be rejected',async()=>{
 const p=await verify(game(),scoreboard());
 assert.equal(validFreshEspnSoccerNo({...p,requestId:undefined},game()),false);
});