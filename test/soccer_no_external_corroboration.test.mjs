import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCorroboratedSoccerNo,SOCCER_NO_EXTERNAL_POLICY,
 validSoccerNoPreflightProof} from '../src/soccer_no_external_proof.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
import {soccerTotalNo} from '../src/soccer_total_no.mjs';
import {soccerFirstHalfNo} from '../src/soccer_first_half_no.mjs';

const start=new Date(Date.now()-3600000).toISOString();
const milestone={id:'exact-match',type:'soccer_match',title:'Alpha vs Beta',
  start_date:start,details:{league:'Soccer',main_game_event_ticker:'KXSOCGAME-26NOV21ALPBET'}};
const game=(minute=83,home=2,away=1,period=2)=>({
 id:milestone.id,type:'soccer_match',sport:'Soccer',period,home,away,
 homeName:'Alpha',awayName:'Beta',soccerMinute:minute,
 verifiedLive:true,clockRunning:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true
});
const espn=(clock="83'",home=2,away=1,period=2,state='in')=>({
 events:[{id:'espn-match',date:start,competitions:[{
 status:{period,displayClock:clock,type:{state}},
 competitors:[
  {homeAway:'home',score:String(home),team:{displayName:'Alpha'}},
  {homeAway:'away',score:String(away),team:{displayName:'Beta'}}
 ]}]}]});
const fox=(clock="2ND HALF 83'",home=2,away=1,status=1)=>({
 sectionList:[{events:[{eventTime:start,eventStatus:status,statusLine:clock,
 entityLink:{layout:{tokens:{id:'12345',homeUri:'h',awayUri:'a'}}},
 upperTeam:{uri:'a',name:'Beta',score:away},
 lowerTeam:{uri:'h',name:'Alpha',score:home}}]}]});
const radar=(minute="83'",home=2,away=1,period=2,publishedAt=new Date().toISOString())=>({
 eventId:'sr:sport_event:12345',time:start,homeAliases:['Alpha'],awayAliases:['Beta'],
 home,away,period,live:true,clock:minute,publishedAt
});
const fetcher=({espnBoard=espn(),foxBoard=fox()}={})=>async url=>({
 ok:true,json:async()=>url.includes('foxsports.com')?foxBoard:espnBoard
});
const verify=(g=game(),options={})=>verifyCorroboratedSoccerNo(g,milestone,{
 fetcher:fetcher(options),sportradarLoad:options.radarLoad||(()=>null),fixtureCache:null
});

test('new soccer NO first checkpoints must be versioned to invalidate previous ESPN-only windows',async()=>{
 const proof=await verify();
 assert.equal(proof?.sourcePolicy,SOCCER_NO_EXTERNAL_POLICY);
 assert.equal(validSoccerNoPreflightProof(proof),true);
 const old={...proof};delete old.sourcePolicy;
 assert.equal(validSoccerNoPreflightProof(old),false);
 assert.equal(validSoccerNoPreflightProof({source:'ESPN',eventId:'first',gameId:'exact-match',
  home:2,away:1,preflight_policy:'late-elapsed-time-30-v4'}),false);
});
test('two independently named live provider scores and clocks authorize a soccer NO proof',async()=>{
 const proof=await verify();
 assert.equal(proof?.home,2);assert.equal(proof?.away,1);
 assert.deepEqual(proof?.verifiedProviders,['ESPN','FOX Sports']);
 assert.equal(proof?.period,2);
 assert.ok(Number.isFinite(proof?.checkedAt));
});
test('two ESPN readings are never mistaken for two independent providers',async()=>{
 const proof=await verify(game(),{foxBoard:{sectionList:[]}});
 assert.equal(proof,null);
});
test('a third independent live Sportradar source can corroborate ESPN when FOX has no league coverage',async()=>{
 const proof=await verify(game(),{
  foxBoard:{sectionList:[]},radarLoad:async()=>[radar()]
 });
 assert.deepEqual(proof?.verifiedProviders,['ESPN','Sportradar']);
});
test('FOX plus independently fresh Sportradar can verify when ESPN is unavailable',async()=>{
 const proof=await verify(game(),{
  espnBoard:{events:[]},radarLoad:async()=>[radar()]
 });
 assert.deepEqual(proof?.verifiedProviders,['FOX Sports','Sportradar']);
});
test('a score disagreement between two live independent providers blocks entry',async()=>{
 assert.equal(await verify(game(),{foxBoard:fox("2ND HALF 83'",3,1)}),false);
 assert.equal(await verify(game(),{foxBoard:fox("2ND HALF 83'",3,1),
  radarLoad:async()=>[radar()]}),false);
});
test('ESPN clock four minutes behind the match is rejected even with matching provider scores',async()=>{
 assert.equal(await verify(game(),{espnBoard:espn("79'")}),false);
});
test('an ESPN full-time or wrong-period game cannot authorize a live soccer trade',async()=>{
 assert.equal(await verify(game(),{espnBoard:espn("83'",2,1,2,'post')}),false);
 assert.equal(await verify(game(),{espnBoard:espn("83'",2,1,1,'in')}),false);
});
test('malformed ESPN clock is unsafe, not a silent permission',async()=>{
 assert.equal(await verify(game(),{espnBoard:espn("unknown")}),false);
});
test('a FOX clock far behind or a non-live FOX match also blocks a trade',async()=>{
 assert.equal(await verify(game(),{foxBoard:fox("2ND HALF 70'")}),false);
 assert.equal(await verify(game(),{foxBoard:fox("2ND HALF 83'",2,1,0)}),false);
});
test('fresh Sportradar data must be provider-timestamped, not just received recently',async()=>{
 const withoutTime=radar();delete withoutTime.publishedAt;
 assert.equal(await verify(game(),{foxBoard:{sectionList:[]},
  radarLoad:async()=>[withoutTime]}),false);
 assert.equal(await verify(game(),{foxBoard:{sectionList:[]},
  radarLoad:async()=>[radar("83'",2,1,2,new Date(Date.now()-25000).toISOString())]}),false);
});
test('independent sources behind Kalshi scoring cannot authorize NO entry',async()=>{
 assert.equal(await verify(game(83,3,1)),false);
});
test('90-plus added time is parsed correctly and may be validated only while live',async()=>{
 const g=game(94,2,1);
 const valid=await verify(g,{espnBoard:espn("90'+4'"),foxBoard:fox("2ND HALF 90+4'")});
 assert.deepEqual(valid?.verifiedProviders,['ESPN','FOX Sports']);
 assert.equal(await verify(g,{espnBoard:espn("90'+4'",2,1,2,'post'),
  foxBoard:fox("2ND HALF 90+4'")}),false);
});
test('first-half soccer NO requires first-half status and matching live elapsed clock',async()=>{
 const g=game(42,0,1,1);
 const yes=await verify(g,{espnBoard:espn("42'",0,1,1),foxBoard:fox("1ST HALF 42'",0,1)});
 assert.equal(yes?.period,1);
 assert.equal(await verify(g,{espnBoard:espn("42'",0,1,2),foxBoard:fox("1ST HALF 42'",0,1)}),false);
});
const fullMarket={event_ticker:'KXSOC​TOTAL-26NOV21ALPBET'.replace('​',''),
 ticker:'KXSOCTOTAL-26NOV21ALPBET-6',title:'Will over 5.5 goals be scored?',
 yes_sub_title:'Over 5.5 goals scored',floor_strike:5.5,strike_type:'greater',
 status:'active',rules_primary:'If over 5.5 goals are scored in the Alpha vs Beta professional Soccer soccer game originally scheduled for Nov 21, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};
const halfMarket={event_ticker:'KXSOC1HTOTAL-26NOV21ALPBET',
 ticker:'KXSOC1HTOTAL-26NOV21ALPBET-4',title:'Over 3.5 1H goals scored',
 yes_sub_title:'Over 3.5 1H goals scored',floor_strike:3.5,strike_type:'greater',
 status:'active',rules_primary:'If the total goals scored by Alpha and Beta is more than 3.5 goals in the 1st Half of the Alpha vs Beta professional Soccer soccer game originally scheduled for Nov 21, 2026, then the market resolves to Yes.'};
const entryGame=(minute=83,period=2)=>({...game(minute,period===1?0:2,1,period),
 mainEvent:'KXSOCGAME-26NOV21ALPBET',feedId:milestone.id,
 observedAt:Date.now(),scoreKnown:true,scoreConsistent:true,periodConsistent:true,
 matchRemainingSeconds:Math.max(0,(90-minute)*60)});
test('raw single-source ESPN cannot authorize a soccer full-game NO signal',()=>{
 const g=entryGame();
 assert.ok(soccerTotalNo(g,fullMarket),'baseline contract must qualify');
 assert.equal(soccerTotalNo(g,fullMarket,{external:{
  source:'ESPN',eventId:'espn-match',gameId:g.id,home:2,away:1,live:true,period:2
 }}),null);
});
test('raw single-source ESPN cannot authorize a first-half soccer NO signal',()=>{
 const g=entryGame(42,1);
 assert.ok(soccerFirstHalfNo(g,halfMarket));
 assert.equal(soccerFirstHalfNo(g,halfMarket,{external:{
  source:'ESPN',eventId:'espn-match',gameId:g.id,home:0,away:1,live:true,period:1
 }}),null);
});
test('fresh two-provider proof remains eligible at the dispatch gate',async()=>{
 const g=entryGame(),proof=await verify(g);
 assert.equal(soccerTotalNo(g,fullMarket,{external:proof})?.total,3);
 assert.equal(soccerTotalNo(g,fullMarket,{external:{...proof,checkedAt:Date.now()-11000}}),null,
  'old external proof cannot be replayed for a late order');
});
test('source-only fetch does not substitute ESPN for a missing distinct FOX provider',async()=>{
 const g=game();
 const missing=await fetchIndependentMatchScore(g,milestone,{
  fetcher:fetcher({foxBoard:{sectionList:[]}}),espnFeed:'soccer/all',foxFeed:'soccer',
  sourceOnly:'FOX Sports',fixtureCache:null});
 assert.equal(missing,null);
});
