import test from 'node:test';
import assert from 'node:assert/strict';
import {espnScoreboardUrls} from '../src/espn_scoreboards.mjs';
import {espnMatches,sameFixture} from '../src/score_verification.mjs';
import {verifyFreshEspnSoccerNo} from '../src/soccer_espn_no.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
import {teamAbbreviationVariants} from '../src/team_identity.mjs';

function soccer({title,league,homeName,awayName,home=2,away=1,at=Date.now()-60*60000}){
 const date=new Date(at).toISOString();
 const milestone={id:'fixture-'+league,type:'soccer_tournament_multi_leg',
  title,start_date:date,details:{league}};
 const game={id:milestone.id,type:milestone.type,sport:'Soccer',home,away,
  homeName:'',awayName:'',verifiedLive:true,scoreKnown:true,scoreConsistent:true,
  periodConsistent:true,period:2,soccerMinute:86,observedAt:Date.now()};
 const board={events:[{id:'espn-unique-event',date,competitions:[{
  status:{period:2,displayClock:"86'",type:{state:'in',completed:false}},
  competitors:[
   {homeAway:'home',score:String(home),team:{displayName:homeName,shortDisplayName:homeName,name:homeName}},
   {homeAway:'away',score:String(away),team:{displayName:awayName,shortDisplayName:awayName,name:awayName}}
  ]}]}]};
 return {game,milestone,board};
}
const empty={events:[]};
const reply=board=>({ok:true,headers:{get:name=>name.toLowerCase()==='age'?'0':null},json:async()=>board});

test('ESPN proves the real Austrian two-team fixture despite exact SCR/SC Rheindorf and SK name differences',()=>{
 const {game,milestone,board}=soccer({title:'SCR Altach vs Sturm Graz',
  league:'Austrian Bundesliga',homeName:'SC Rheindorf Altach',awayName:'SK Sturm Graz'});
 const matches=espnMatches(board,game,milestone,{identityOnly:true});
 assert.equal(matches.length,1);
 assert.equal(matches[0].source,'ESPN');
 assert.equal(matches[0].eventId,'espn-unique-event');
 const falseClub=structuredClone(board);
 falseClub.events[0].competitions[0].competitors[1].team={displayName:'Sturm Graz Rivals'};
 assert.equal(espnMatches(falseClub,game,milestone,{identityOnly:true}).length,0,
  'a similarly named rival must never become the same fixture');
});

test('ESPN proves the Greek fixture when Kalshi uses Atromitos Athinon and ESPN Atromitos',()=>{
 const {game,milestone,board}=soccer({title:'Levadiakos vs Atromitos Athinon',
  league:'Greece Super League',homeName:'Levadiakos',awayName:'Atromitos'});
 assert.equal(espnMatches(board,game,milestone,{identityOnly:true}).length,1);
 assert.equal(teamAbbreviationVariants('Atromitos Athinon','Soccer').includes('Atromitos'),true);
});

test('covered soccer leagues route to directly verified ESPN league feeds, but unsupported leagues do not borrow a different league',()=>{
 const urls=league=>espnScoreboardUrls('soccer/all',{sport:'Soccer'},
  {details:{league}},['20261122']);
 for(const [league,slug] of [
  ['Bundesliga','ger.1'],['Greece Super League','gre.1'],
  ['Austrian Bundesliga','aut.1'],['Serie A','ita.1'],
  ['Eredivisie','ned.1'],['EPL','eng.1'],
  ['Serie B','ita.2'],['Ligue 2','fra.2'],['La Liga','esp.1'],['Spanish Liga F','esp.w.1'],
  ['APF Division de Honor','par.1'],['Uruguay Primera Division','uru.1'],
  ['NCAAB','all'] // a soccer label cannot use college basketball feeds
 ])assert.ok(urls(league)[0].includes('/soccer/'+slug+'/scoreboard'),league);
 for(const league of ['Slovakia Niké liga','Ekstraklasa','Serie C','KHL','Unidentified League'])
  assert.ok(urls(league)[0].includes('/soccer/all/scoreboard'),league);
 assert.ok(espnScoreboardUrls('hockey/nhl',{sport:'NHL'},{},['20261122'])[0].includes('/hockey/nhl/'));
 assert.ok(espnScoreboardUrls('hockey/mens-college-hockey',{sport:'College Hockey'},{},['20261122'])[0].includes('/hockey/mens-college-hockey/'));
});

test('league-specific ESPN club aliases match only the confirmed teams and near-exact kickoff',()=>{
 for(const [title,league,homeName,awayName,at] of [
  ['Sochaux-Montbeliard vs Dunkerque','Ligue 2','Sochaux','Dunkerque','2026-11-23T19:45:00Z'],
  ['Universitario de Vinto vs GV Club Deportivo San Jose de Oruro','Bolivia Premier Division','Universitario de Vinto','GV San José','2026-11-23T21:15:00Z'],
  ['CS 2 de Mayo vs San Lorenzo','APF Division de Honor','2 de Mayo','Sportivo San Lorenzo','2026-11-23T21:00:00Z'],
  ['Las Piedras vs Defensor','Uruguay Primera Division','Juventud','Defensor Sporting','2026-11-23T19:30:00Z']
 ]){
  const {game,milestone,board}=soccer({title,league,homeName,awayName,at:Date.parse(at)});
  assert.equal(espnMatches(board,game,milestone,{identityOnly:true}).length,1,title);
  assert.equal(sameFixture(game,{...milestone,details:{league:'Unrelated League'}},[homeName],[awayName],at),false,title+' wrong league');
  assert.equal(sameFixture(game,milestone,[homeName],[awayName],new Date(Date.parse(at)+20*60000).toISOString()),false,title+' wrong kickoff');
  assert.equal(sameFixture(game,milestone,[homeName],['Other Club'],at),false,title+' wrong opponent');
 }
});

test('soccer-NO exact ESPN proof falls back to all only after covered league board lacks the fixture',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz'});
 const urls=[];
 const proof=await verifyFreshEspnSoccerNo(game,milestone,{fetcher:async url=>{
  urls.push(url);
  return reply(url.includes('/soccer/all/')?board:empty);
 }});
 assert.equal(proof?.source,'ESPN');
 assert.equal(proof?.eventId,'espn-unique-event');
 assert.ok(urls.some(url=>url.includes('/soccer/ger.1/scoreboard')));
 assert.ok(urls.some(url=>url.includes('/soccer/all/scoreboard')));
});

test('covered ESPN matchup yields a live verified source, including normal non-soccer scoreboard routing',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz'});
 const urls=[];
 const result=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:null,
  fetcher:async url=>{urls.push(url);return reply(url.includes('/soccer/all/')?board:empty)}});
 assert.equal(result?.source,'ESPN');
 assert.equal(result.eventId,'espn-unique-event');
 assert.ok(urls.some(url=>url.includes('/soccer/ger.1/scoreboard')));
 assert.ok(urls.some(url=>url.includes('/soccer/all/scoreboard')));
});

test('a located ESPN fixture with non-live status remains a veto; never use all-leagues to override it',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz'});
 board.events[0].competitions[0].status.type.state='post';
 const urls=[];
 const proof=await verifyFreshEspnSoccerNo(game,milestone,{fetcher:async url=>{
  urls.push(url);return reply(board);
 }});
 assert.equal(proof,false);
 assert.ok(urls.some(url=>url.includes('/soccer/ger.1/scoreboard')));
 assert.equal(urls.filter(url=>url.includes('/soccer/all/')).length,0);
});

test('ESPN independently verified score overrides an erroneous Kalshi score on an exact live soccer fixture',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz',home:3,away:1});
 const incorrectKalshi={...game,home:1,away:1};
 const proof=await verifyFreshEspnSoccerNo(incorrectKalshi,milestone,{fetcher:async()=>reply(board)});
 assert.equal(proof?.source,'ESPN');
 assert.deepEqual([proof?.home,proof?.away],[3,1]);
});

test('ESPN source minute overrides an erroneous Kalshi clock, without accepting a missing ESPN clock',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz',home:3,away:1});
 const incorrectKalshi={...game,soccerMinute:80};
 const proof=await verifyFreshEspnSoccerNo(incorrectKalshi,milestone,{fetcher:async()=>reply(board)});
 assert.equal(proof?.elapsedMinute,86);
 assert.equal(proof?.source,'ESPN');
 const missingClock=structuredClone(board);
 missingClock.events[0].competitions[0].status.displayClock='';
 assert.notEqual(await verifyFreshEspnSoccerNo(game,milestone,{fetcher:async()=>reply(missingClock)}),true);
});

test('the ordinary ESPN independently matched fixture also carries its verified elapsed minute',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz',home:3,away:1});
 const reading=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:null,
  fetcher:async()=>reply(board)});
 assert.equal(reading?.source,'ESPN');
 assert.equal(reading?.elapsedMinute,86);
});

test('ordinary soccer OVERs use ESPN league feed first and all-soccer only for an unavailable fixture',async()=>{
 const {game,milestone,board}=soccer({title:'Augsburg vs Mainz',league:'Bundesliga',
  homeName:'FC Augsburg',awayName:'Mainz',home:3,away:1});
 board.events[0].competitions[0].details=Array.from({length:4},()=>({scoringPlay:true,scoreValue:1}));
 const market={ticker:'KXBUNDESLIGATOTAL-26NOV22FCAM05-3',
  event_ticker:'KXBUNDESLIGATOTAL-26NOV22FCAM05',status:'active',
  title:'Will over 2.5 goals be scored?',floor_strike:2.5};
 const urls=[];
 const {verifyIndependentOverDecision}=await import('../src/score_verification.mjs');
 const result=await verifyIndependentOverDecision(game,milestone,{market,
  fetcher:async url=>{urls.push(url);return reply(url.includes('/soccer/all/')?board:empty)}});
 assert.equal(result,true);
 assert.ok(urls.some(url=>url.includes('/soccer/ger.1/scoreboard')));
 assert.ok(urls.some(url=>url.includes('/soccer/all/scoreboard')));
});