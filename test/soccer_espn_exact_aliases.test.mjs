import test from 'node:test';
import assert from 'node:assert/strict';
import {teamAbbreviationVariants} from '../src/team_identity.mjs';
import {espnMatches} from '../src/score_verification.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';

// These names, scores, and ESPN event IDs are copied from ESPN's actual
// November 20 scoreboard for the matching Kalshi league events.
const original=[
 {kalshi:'Molde vs Bodoe/Glimt',score:[1,4],eventId:'401843486',start:'2026-11-20T18:00:00Z',
  home:'Molde',away:'Bodo/Glimt',homeShort:'Molde',awayShort:'Bodo/Glimt',league:'Eliteserien',
  game:'KXELITESERIENGAME-26NOV20MFKBOG'},
 {kalshi:'Aarhus vs Lyngby',score:[2,1],eventId:'401874492',start:'2026-11-20T18:00:00Z',
  home:'AGF',away:'Lyngby Boldklub',homeShort:'AGF',awayShort:'Lyngby',league:'Danish Superliga',
  game:'KXDENSUPERLIGAGAME-26NOV20AGFLBY'}
];
const inputs=x=>{
 const milestone={id:'kalshi-'+x.eventId,type:'soccer_tournament_multi_leg',title:x.kalshi,start_date:x.start,
  details:{league:x.league,main_game_event_ticker:x.game}};
 const game={id:milestone.id,type:milestone.type,sport:'Soccer',home:x.score[0],away:x.score[1],
  verifiedLive:true,homeName:'',awayName:''};
 const scoreboard={events:[{id:x.eventId,date:x.start,competitions:[{
  status:{type:{state:'in'},period:2,displayClock:"88'"},competitors:[
   {homeAway:'home',score:String(x.score[0]),team:{displayName:x.home,shortDisplayName:x.homeShort,name:x.home,location:x.home}},
   {homeAway:'away',score:String(x.score[1]),team:{displayName:x.away,shortDisplayName:x.awayShort,name:x.away,location:x.away}}
  ]}]}]};
 return {game,milestone,scoreboard};
};
const fetchOne=board=>async url=>({ok:true,json:async()=>({events:url.includes('dates=20261120')?board.events:[]})});
for(const x of original){
 test('ESPN exact match is not unavailable for '+x.kalshi,async()=>{
  const {game,milestone,scoreboard}=inputs(x);
  const matches=espnMatches(scoreboard,game,milestone);
  assert.equal(matches.length,1,'valid two-team ESPN fixture should match');
  assert.deepEqual([matches[0].home,matches[0].away],x.score);
  const proof=await fetchIndependentMatchScore(game,milestone,{fetcher:fetchOne(scoreboard),espnFeed:'soccer/all'});
  assert.equal(proof?.source,'ESPN');assert.equal(proof?.eventId,x.eventId);
  assert.deepEqual([proof?.home,proof?.away],x.score);
 });
 test('wrong team blocked but independently confirmed source score controls '+x.kalshi,async()=>{
  const {game,milestone,scoreboard}=inputs(x);
  const wrong=structuredClone(scoreboard);wrong.events[0].competitions[0].competitors[1].team={displayName:'Different Club',shortDisplayName:'Different Club',name:'Different Club',location:'Different Club'};
  assert.equal(espnMatches(wrong,game,milestone).length,0);
  const score=structuredClone(scoreboard);score.events[0].competitions[0].competitors[0].score=String(x.score[0]+1);
  assert.equal((await fetchIndependentMatchScore(game,milestone,{fetcher:fetchOne(score),espnFeed:'soccer/all'}))?.home,x.score[0]+1,
    'verified source score is authoritative even when Kalshi reports another score');
 });
}
test('only explicitly documented soccer team aliases are interchangeable, not unrelated clubs',()=>{
 assert.ok(teamAbbreviationVariants('Bodoe/Glimt','Soccer').includes('Bodo/Glimt'));
 assert.ok(teamAbbreviationVariants('Aarhus','Soccer').includes('AGF'));
 assert.ok(!teamAbbreviationVariants('Aarhus','Soccer').includes('Molde'));
 assert.ok(!teamAbbreviationVariants('Bodoe/Glimt','Soccer').includes('AGF'));
});