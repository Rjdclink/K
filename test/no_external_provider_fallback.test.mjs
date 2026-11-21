import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchIndependentMatchScore,scorePairMatches,pairedExternalMatch} from '../src/independent_match_score.mjs';
import {tagNoPreflight,validNoPreflight,NO_PREFLIGHT_POLICY} from '../src/late_no_preflight.mjs';
const start=new Date(Date.now()-15*60000).toISOString();
const m={id:'foo',title:'Alpha vs Beta',type:'soccer_match',start_date:start,details:{league:'Soccer'}};
const g={id:'foo',sport:'Soccer',type:'soccer_match',home:3,away:3,homeName:'Alpha',awayName:'Beta',period:2,soccerMinute:84,verifiedLive:true};
const espnScore=(a=3,b=3)=>({events:[{id:'espn-foo',date:start,competitions:[{status:{period:2,displayClock:"62'",type:{state:'in'}},competitors:[
 {homeAway:'home',score:String(a),team:{displayName:'Alpha'}},
 {homeAway:'away',score:String(b),team:{displayName:'Beta'}}]}]}]});
const foxScore=(a=3,b=3)=>({sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:"61'",entityLink:{layout:{tokens:{id:'12233',homeUri:'h',awayUri:'a'}}},
 upperTeam:{uri:'a',name:'Beta',score:b},lowerTeam:{uri:'h',name:'Alpha',score:a}}]}]});
const read=(data,ok=true)=>({ok,json:async()=>data});

test('two unavailable ESPN attempts precede FOX, which verifies team identity and score without external time equality',async()=>{
 const calls=[],fetcher=async url=>{
  calls.push(url);
  return /espn/.test(url)?read({events:[]}):read(foxScore());
 };
 const result=await fetchIndependentMatchScore(g,m,{fetcher,espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.equal(result?.source,'FOX Sports');
 assert.equal(result?.eventId,'12233');
 assert.equal(result?.home,3);
 assert.equal(result?.away,3);
 assert.equal(calls.filter(url=>/espn/.test(url)).length,6);
 assert.ok(calls.findIndex(url=>/foxsports/.test(url))>calls.findLastIndex(url=>/espn/.test(url)));
 const proof=tagNoPreflight(result);
 assert.equal(proof?.preflight_policy,NO_PREFLIGHT_POLICY);
 assert.equal(validNoPreflight({game_id:'foo',contract_key:'key',period:2,first_clock:420,first_evidence:proof,first_at:new Date(Date.now()-61000)},
  {gameId:'foo',contractKey:'key',period:2,maxFirstSeconds:540}),true);
});
test('uniquely matched ESPN fixture supplies authoritative score and prevents unnecessary FOX fallback',async()=>{
 const calls=[],fetcher=async url=>{calls.push(url);return read(/espn/.test(url)?espnScore(2,3):foxScore())};
 const result=await fetchIndependentMatchScore(g,m,{fetcher,espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.deepEqual([result?.source,result?.home,result?.away],['ESPN',2,3],'independent ESPN score controls the NO cushion');
 assert.ok(calls.every(url=>/espn/.test(url)));
});
test('first matching ESPN fixture stops the retry and prevents FOX use',async()=>{
 const calls=[],fetcher=async url=>{calls.push(url);return read(/espn/.test(url)?espnScore():foxScore())};
 const result=await fetchIndependentMatchScore(g,m,{fetcher,espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.equal(result?.source,'ESPN');
 assert.equal(result?.home,3);
 assert.equal(calls.filter(url=>/espn/.test(url)).length,3);
 assert.ok(calls.every(url=>/espn/.test(url)));
});
test('wrong teams and ambiguous fixtures fail closed; source scores need not equal Kalshi',async()=>{
 assert.equal(scorePairMatches({source:'FOX Sports',eventId:'123',home:4,away:3},g),true);
 assert.equal(scorePairMatches({source:'ESPN',eventId:'',home:3,away:3},g),false);
 const mismatch=foxScore();mismatch.sectionList[0].events[0].lowerTeam.name='Gamma';
 const bad=await fetchIndependentMatchScore(g,m,{fetcher:async url=>read(/espn/.test(url)?{events:[]}:mismatch),espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.equal(bad,null);
 const duplicate=espnScore();duplicate.events.push({...duplicate.events[0],id:'other'});
 const uncertain=await fetchIndependentMatchScore(g,m,{fetcher:async()=>read(duplicate),espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.equal(uncertain,false);
});

test('ESPN first and FOX second can verify one matched Kalshi game without sharing provider event IDs',()=>{
 const first={source:'ESPN',eventId:'espn-first',gameId:'foo',home:2,away:2};
 const second={source:'FOX Sports',eventId:'12233',gameId:'foo',home:3,away:3};
 assert.equal(pairedExternalMatch(first,second,g),true);
 assert.equal(pairedExternalMatch(first,{...second,gameId:'unrelated'},g),false);
 assert.equal(pairedExternalMatch({...first,source:'FOX Sports',eventId:'other'},second,g),false);
 assert.equal(pairedExternalMatch(first,{...second,home:1},g),false,'external score must not regress');
});