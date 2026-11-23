import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBbcScores,parseNhlScore,parseNhlLanding,parseNflScores,loadOfficialScores} from '../src/official_score_fallback.mjs';
import {fetchIndependentMatchScore,pairedExternalMatch} from '../src/independent_match_score.mjs';
import {verifyFreshEspnSoccerNo,pairedFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';
import {verifyFreshEspnHockeyNo,pairedFreshEspnHockeyNo} from '../src/hockey_espn_no.mjs';

const start=new Date(Date.now()-25*60000).toISOString();
const milestone={id:'fixture',title:'Alpha vs Beta',start_date:start,details:{league:'Test league'}};
const game={id:'fixture',type:'soccer_match',sport:'Soccer',home:0,away:1,
 homeName:'Alpha',awayName:'Beta',period:2,soccerMinute:87,observedAt:Date.now()-100,
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true};
const bbcEvent=(more={})=>({id:'s-123',startDateTime:start,status:'MidEvent',
 home:{fullName:'Alpha',score:'0'},away:{fullName:'Beta',score:'1'},periodLabel:{value:"87'"},...more});
const bbc=events=>'window.__INITIAL_DATA__='+JSON.stringify(JSON.stringify({data:{
 'sport-data-scores-fixtures?test':{data:{eventGroups:[{secondaryGroups:[{events}]}]}}
 }}))+';';
const nhlGame={id:123,startTimeUTC:start,gameState:'LIVE',periodDescriptor:{number:3},
 clock:{secondsRemaining:240},homeTeam:{abbrev:'ALP',name:{default:'Alpha'},score:2},
 awayTeam:{abbrev:'BET',name:{default:'Beta'},score:1}};
const nhlLanding={...nhlGame,summary:{scoring:[
 {periodDescriptor:{number:1},goals:[{teamAbbrev:{default:'ALP'}}]},
 {periodDescriptor:{number:2},goals:[{teamAbbrev:{default:'ALP'}},{teamAbbrev:{default:'BET'}}]},
 {periodDescriptor:{number:3},goals:[]}]}};
const response=(url,{stale=false,events=[bbcEvent()]}={})=>({ok:true,
 headers:new Headers({age:stale?'16':'0'}),
 json:async()=>url.includes('espn.com')?{events:[]}:url.includes('/landing')?nhlLanding:
  {games:url.endsWith(start.slice(0,10))?[nhlGame]:[]},
 text:async()=>bbc(events)});

test('BBC live fixture supplies score, minute and exact identity after ESPN retry',async()=>{
 const calls=[],proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',
  fetcher:async url=>{calls.push(url);return response(url)}});
 const hour=new Date(start).getUTCHours();
 assert.equal(calls.filter(url=>url.includes('espn.com')).length,2*(hour<6||hour>=21?2:1));
 assert.ok(calls.findIndex(url=>url.includes('bbc.com'))>calls.findLastIndex(url=>url.includes('espn.com')));
 assert.deepEqual([proof?.source,proof?.eventId,proof?.home,proof?.away,proof?.elapsedMinute],
  ['BBC Sport','s-123',0,1,87]);
 assert.equal(pairedExternalMatch({source:'ESPN',eventId:'old',gameId:game.id,home:0,away:1},proof,game),true);
});
test('BBC rejects missing clocks, nonlive status, wrong scores and stale pages',async()=>{
 assert.equal(parseBbcScores(bbc([bbcEvent({periodLabel:{value:''}})])).length,0);
 assert.equal(parseBbcScores(bbc([bbcEvent({periodLabel:{value:"90+3'"}})]))[0]?.elapsedMinute,93);
 assert.equal(parseBbcScores(bbc([bbcEvent({status:'PostEvent'})])).length,0);
 assert.equal(parseBbcScores(bbc([bbcEvent({home:{fullName:'Alpha'}})])).length,0);
 assert.equal(await loadOfficialScores(game,milestone,{fetcher:async url=>response(url,{stale:true})}),null);
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:null,
  fetcher:async url=>response(url,{events:[bbcEvent({home:{fullName:'Other',score:'0'}})]})});
 assert.equal(proof,null);
});
test('two distinct BBC proofs work when ESPN does not list the soccer fixture',async()=>{
 const fetcher=async url=>response(url),first=await verifyFreshEspnSoccerNo(game,milestone,{fetcher});
 const second=await verifyFreshEspnSoccerNo(game,milestone,{fetcher});
 assert.equal(first?.source,'BBC Sport');
 assert.equal(pairedFreshEspnSoccerNo(first,first,game),false);
 assert.equal(pairedFreshEspnSoccerNo(first,second,game),true);
});
test('NHL live score requires a matching gamecenter scoring timeline and clock',async()=>{
 const hockey={...game,type:'hockey_match',sport:'NHL',period:3,home:2,away:1,
  remainingSeconds:240};
 assert.deepEqual(parseNhlLanding(nhlLanding,parseNhlScore(nhlGame))?.periods.map(p=>p.home),[1,1,0]);
 assert.equal(parseNhlLanding({...nhlLanding,clock:{secondsRemaining:200}},parseNhlScore(nhlGame))?.seconds,200);
 assert.equal(parseNhlLanding({...nhlLanding,clock:{secondsRemaining:260}},parseNhlScore(nhlGame)),null);
 const fetcher=async url=>response(url);
 const first=await verifyFreshEspnHockeyNo(hockey,milestone,{fetcher});
 const second=await verifyFreshEspnHockeyNo(hockey,milestone,{fetcher});
 assert.equal(first?.source,'NHL');
 assert.deepEqual(first?.periods.map(p=>p.home),[1,1,0]);
 assert.equal(pairedFreshEspnHockeyNo(first,second,hockey),true);
});
test('NFL page only accepts a live, scored quarter with an independent clock',()=>{
 const card={gameId:'uuid-123',gameTime:start,gameSummary:{phase:'LIVE',quarter:'Q4',clock:'02:13',
  homeTeam:{score:{total:10}},awayTeam:{score:{total:7}}},
  homeTeam:{abbreviation:'BUF',standings:{team:{fullName:'Buffalo Bills'}}},
  awayTeam:{abbreviation:'MIA',standings:{team:{fullName:'Miami Dolphins'}}}};
 const html=c=>'self.__next_f.push([1,'+JSON.stringify('29:'+JSON.stringify([null,null,null,
  {state:{queries:[{state:{data:{data:{carouselCardPropsList:[c]}}}}]}}]))+'])';
 assert.deepEqual([parseNflScores(html(card))[0]?.home,parseNflScores(html(card))[0]?.seconds],[10,133]);
 assert.equal(parseNflScores(html({...card,gameSummary:{...card.gameSummary,phase:'PREGAME'}})).length,0);
 assert.equal(parseNflScores(html({...card,gameSummary:{...card.gameSummary,clock:null}})).length,0);
});
test('NFL fallback matches the exact named fixture and carries its own clock into entry',async()=>{
 const football={...game,type:'football_game',sport:'NFL',homeName:'Buffalo Bills',
  awayName:'Miami Dolphins',period:4};
 const card={gameId:'uuid-123',gameTime:start,gameSummary:{phase:'LIVE',quarter:'Q4',clock:'02:13',
  homeTeam:{score:{total:10}},awayTeam:{score:{total:7}}},
  homeTeam:{abbreviation:'BUF',standings:{team:{fullName:'Buffalo Bills'}}},
  awayTeam:{abbreviation:'MIA',standings:{team:{fullName:'Miami Dolphins'}}}};
 const page=cards=>'self.__next_f.push([1,'+JSON.stringify('29:'+JSON.stringify([null,null,null,
  {state:{queries:[{state:{data:{data:{carouselCardPropsList:cards}}}}]}}]))+'])';
 const fetcher=async()=>({ok:true,headers:new Headers({age:'0'}),text:async()=>page([card])});
 const proof=await fetchIndependentMatchScore(football,milestone,{espnFeed:null,fetcher});
 assert.deepEqual([proof?.source,proof?.home,proof?.away,proof?.period,proof?.seconds],
  ['NFL',10,7,4,133]);
 assert.equal(await fetchIndependentMatchScore({...football,awayName:'New York Jets'},milestone,
  {espnFeed:null,fetcher}),null);
});
