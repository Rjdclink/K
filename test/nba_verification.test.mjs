import test from 'node:test';
import assert from 'node:assert/strict';
import {nbaFixtures,nbaAgreement,verifyIndependentOver} from '../src/score_verification.mjs';
const start='2026-10-29T00:00:00Z',id='0022600137';
const milestone={title:'NYK Knicks at CHI Bulls',start_date:start};
const game={type:'basketball_game',sport:'NBA',scoreKnown:true,home:127,away:133,homeName:'CHI Bulls',awayName:'NYK Knicks',playerStats:{p:{rebounds:6}},periodScores:[{number:1,home:33,away:34}]};
const market={event_ticker:'KXNBAREB-X',yes_sub_title:'Matas Buzelis: 6+',floor_strike:5.5,custom_strike:{basketball_player:'p'}};
const fixture={gameId:id,gameTimeUTC:start,gameStatus:2,homeTeam:{teamCity:'Chicago',teamName:'Bulls',teamTricode:'CHI',score:127,periods:[{period:1,score:33}],players:[{name:'Matas Buzelis',statistics:{reboundsTotal:6}}]},awayTeam:{teamCity:'New York',teamName:'Knicks',teamTricode:'NYK',score:133,periods:[{period:1,score:34}],players:[]}};
test('NBA exact fixture and player stats distinguish agreement, disagreement and unavailable',()=>{
 assert.equal(nbaFixtures({scoreboard:{games:[fixture]}},game,milestone).length,1);
 assert.equal(nbaAgreement({game:fixture},game,milestone,market,id),true);
 const corrected=structuredClone(fixture);corrected.homeTeam.players[0].statistics.reboundsTotal=5;
 assert.equal(nbaAgreement({game:corrected},game,milestone,market,id),false);
 assert.equal(nbaAgreement({game:fixture},game,milestone,market,'other'),null);
 assert.equal(nbaAgreement({},game,milestone,market,id),null);
 assert.equal(nbaFixtures({scoreboard:{games:[{...fixture,gameTimeUTC:'2026-10-30T00:00:00Z'}]}},game,milestone).length,0);
});
test('NBA game and period overs compare their respective scores',()=>{
 assert.equal(nbaAgreement({game:fixture},game,milestone,{event_ticker:'KXNBATOTAL-X'},id),true);
 assert.equal(nbaAgreement({game:fixture},{...game,home:128},milestone,{event_ticker:'KXNBATOTAL-X'},id),false);
 assert.equal(nbaAgreement({game:fixture},game,milestone,{event_ticker:'KXNBA1QTOTAL-X'},id),true);
 const changed=structuredClone(fixture);changed.homeTeam.periods[0].score=32;
 assert.equal(nbaAgreement({game:changed},game,milestone,{event_ticker:'KXNBA1QTOTAL-X'},id),false);
});
test('NBA official data governs when available and ESPN is used when NBA is unavailable',async()=>{
 const espn={events:[{id:'espn',date:start,competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'home',score:127,team:{abbreviation:'CHI',name:'Bulls'}},{homeAway:'away',score:133,team:{abbreviation:'NYK',name:'Knicks'}}]}]}]};
 const summary={boxscore:{players:[{statistics:[{names:['REB'],athletes:[{athlete:{displayName:'Matas Buzelis'},stats:['6']}]}]}]}};
 const run=async(value,espnOk=true)=>verifyIndependentOver(game,milestone,{market,fetcher:async url=>{
  if(url.includes('cdn.nba.com')&&value===null)throw Error('403');
  const official=structuredClone(fixture);official.homeTeam.players[0].statistics.reboundsTotal=value;
  const data=url.includes('todaysScoreboard')?{scoreboard:{games:[fixture]}}:url.includes('boxscore_')?{game:official}:url.includes('/summary?')?summary:url.includes('espn.com')?(espnOk?espn:{}):{};
  return {ok:true,json:async()=>data};
 }});
 assert.equal(await run(6),true);
 assert.equal(await run(5),false);
 assert.equal(await run(null),true);
 assert.equal(await run(6,false),true);
 assert.equal(await run(null,false),false);
});
test('CBS supplies a player statistic only when NBA and preferred scoreboards are unavailable',async()=>{
 const path='https://www.cbssports.com/nba/gametracker/boxscore/NBA_20261028_NY@CHI/';
 const html=path+'<table class="stats-table"><tr><td>PLAYER</td><td>REB</td></tr><tr><td><a href="/nba/players/123/matas-buzelis/">Matas Buzelis</a></td><td>6</td></tr></table>';
 const run=async(value)=>verifyIndependentOver(game,milestone,{market,fetcher:async url=>{
   if(url.includes('cdn.nba.com')||url.includes('espn.com')||url.includes('foxsports.com')||url.includes('yahoo.com'))throw Error('unavailable');
   return {ok:true,text:async()=>html.replace('<td>6</td>',`<td>${value}</td>`)};
 }});
 assert.equal(await run(6),true);
 assert.equal(await run(5),false);
});
