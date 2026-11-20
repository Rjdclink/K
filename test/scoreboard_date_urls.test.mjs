import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
import {espnMatches} from '../src/score_verification.mjs';

const start='2026-11-20T17:00:00Z';
const soccer={id:'kalshi-idv-mac',type:'soccer_tournament_multi_leg',sport:'Soccer',verifiedLive:true,
  home:0,away:1,homeName:'',awayName:''};
const soccerM={id:soccer.id,type:soccer.type,title:'Ind. del Valle vs Macara',start_date:start,details:{league:'Ecuador LigaPro'}};
const soccerEvent={id:'401921320',date:'2026-11-20T17:00Z',competitions:[{status:{period:2,displayClock:"88'",type:{state:'in'}},competitors:[
 {homeAway:'home',score:'0',team:{displayName:'Independiente del Valle',shortDisplayName:'Ind. del Valle',name:'Independiente del Valle',abbreviation:'IDV'}},
 {homeAway:'away',score:'1',team:{displayName:'Macará',shortDisplayName:'Macará',name:'Macará',abbreviation:'MAC'}}
 ]}]};
const women={id:'kalshi-alcorn-tulane',type:'basketball_game',sport:'NCAAW',verifiedLive:true,home:76,away:39,homeName:'Tulane',awayName:'Alcorn St.'};
const womenM={id:women.id,type:women.type,title:'Alcorn St. at Tulane',start_date:start,details:{league:'NCAAWB'}};
const womenEvent={id:'401916060',date:'2026-11-20T17:00Z',competitions:[{status:{period:4,displayClock:'0:00',type:{state:'post'}},competitors:[
 {homeAway:'home',score:'76',team:{displayName:'Tulane Green Wave',shortDisplayName:'Tulane',location:'Tulane',name:'Green Wave',abbreviation:'TULN'}},
 {homeAway:'away',score:'39',team:{displayName:'Alcorn State Lady Braves',shortDisplayName:'Alcorn St',location:'Alcorn State',name:'Lady Braves',abbreviation:'ALCN'}}
 ]}]};

test('ESPN dates use eight digits and verify the actual Ecuador LigaPro fixture in the aggregate feed',async()=>{
 const calls=[],fetcher=async url=>{
  calls.push(url);
  const valid=/[?&]dates=\d{8}(?:&|$)/.test(url);
  return {ok:valid,status:valid?200:400,json:async()=>({events:url.includes('dates=20261120')?[soccerEvent]:[]})};
 };
 const result=await fetchIndependentMatchScore(soccer,soccerM,{fetcher,espnFeed:'soccer/all',foxFeed:null});
 assert.equal(result?.source,'ESPN','ESPN event is present and must verify without any fallback');
 assert.equal(result?.eventId,'401921320');
 assert.equal(result?.home,0);assert.equal(result?.away,1);
 assert.equal(calls.length,3);
 assert.ok(calls.every(url=>/[?&]dates=\d{8}(?:&|$)/.test(url)),calls.join('\n'));
 assert.ok(calls.some(url=>url.includes('dates=20261120')));
});

test('ESPN women’s college scoreboard uses a valid division-50 date and matches Alcorn St. at Tulane',async()=>{
 const calls=[],fetcher=async url=>{
  calls.push(url);
  const valid=/[?&]dates=\d{8}(?:&|$)/.test(url)&&url.includes('groups=50');
  return {ok:valid,status:valid?200:400,json:async()=>({events:url.includes('dates=20261120')?[womenEvent]:[]})};
 };
 const result=await fetchIndependentMatchScore(women,womenM,{fetcher,espnFeed:'basketball/womens-college-basketball',foxFeed:null});
 assert.equal(result?.source,'ESPN');assert.equal(result?.eventId,'401916060');
 assert.deepEqual([result?.home,result?.away],[76,39]);
 assert.ok(calls.every(url=>url.includes('groups=50')&&/[?&]dates=\d{8}(?:&|$)/.test(url)));
});

test('an ESPN fixture with a different team or score still fails closed despite valid scoreboard dates',async()=>{
 const bad=structuredClone(soccerEvent);bad.competitions[0].competitors[0].score='2';
 const fetcher=async url=>({ok:true,json:async()=>({events:url.includes('dates=20261120')?[bad]:[]})});
 assert.equal(await fetchIndependentMatchScore(soccer,soccerM,{fetcher,espnFeed:'soccer/all',foxFeed:null}),false);
 const unrelated=structuredClone(soccerEvent);unrelated.competitions[0].competitors[0].team.shortDisplayName='Another Club';
 unrelated.competitions[0].competitors[0].team.displayName='Another Club';
 unrelated.competitions[0].competitors[0].team.name='Another Club';unrelated.competitions[0].competitors[0].team.abbreviation='ANX';
 assert.equal(espnMatches({events:[unrelated]},soccer,soccerM).length,0);
});

test('date-based FOX fallback URLs are also valid after two unavailable ESPN attempts',async()=>{
 const calls=[],foxEvent={eventTime:start,eventStatus:1,statusLine:"88'",entityLink:{layout:{tokens:{id:'4019',homeUri:'home',awayUri:'away'}}},
  upperTeam:{uri:'away',name:'Macará',score:1},lowerTeam:{uri:'home',name:'Ind. del Valle',score:0}};
 const fetcher=async url=>{
  calls.push(url);
  if(url.includes('espn.com'))return {ok:true,json:async()=>({events:[]})};
  const valid=/\/c0d\d{8}\?/.test(url);
  return {ok:valid,status:valid?200:400,json:async()=>({sectionList:[{events:url.includes('c0d20261120')?[foxEvent]:[]}]})};
 };
 const result=await fetchIndependentMatchScore(soccer,soccerM,{fetcher,espnFeed:'soccer/all',foxFeed:'soccer'});
 assert.equal(result?.source,'FOX Sports');assert.equal(result?.home,0);assert.equal(result?.away,1);
 assert.equal(calls.filter(url=>url.includes('espn.com')).length,6);
 assert.ok(calls.some(url=>url.includes('/c0d20261120?')));
});