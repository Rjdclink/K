import test from 'node:test';
import assert from 'node:assert/strict';
import {espnMatches,foxMatches} from '../src/score_verification.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
const start='2026-11-20T18:00:00Z';
const mk=(homeName,awayName,home,away,sport='Soccer',type='soccer_tournament_multi_leg')=>({
  game:{id:'k-relaxed-1',type,sport,verifiedLive:true,home,away,homeName,awayName},
  milestone:{id:'k-relaxed-1',type,title:homeName+' vs '+awayName,start_date:start,
    details:{league:sport==='Soccer'?'Norwegian Eliteserien':sport}}
});
const event=({id='espn-abc',home='Northbridge Wanderers',away='Southport United',homeScore=2,awayScore=1,
 date=start,homeShort='Northbridge Wanderers',awayShort='Southport United'}={})=>({id,date,uid:'s:600~l:3913~e:'+id,
 competitions:[{status:{type:{state:'in'},period:2,displayClock:'07:00'},competitors:[
  {homeAway:'home',score:String(homeScore),team:{displayName:home,shortDisplayName:homeShort,name:home,abbreviation:'NBW'}},
  {homeAway:'away',score:String(awayScore),team:{displayName:away,shortDisplayName:awayShort,name:away,abbreviation:'SPU'}}
 ]}]});
const fetchBoard=events=>async url=>({ok:true,json:async()=>({events:url.includes('dates=20261120')?events:[]})});

test('new club abbreviations resolve automatically when both teams and exact scores match the same kickoff',async()=>{
 const {game,milestone}=mk('Northbridge Wndrs','Southport Utd',2,1);
 const board={events:[event()]};
 assert.equal(espnMatches(board,game,milestone).length,1);
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',fetcher:fetchBoard(board.events)});
 assert.equal(proof?.source,'ESPN');assert.equal(proof?.eventId,'espn-abc');
});

test('relaxed matching works for sport-specific short forms, without hardcoding names',()=>{
 for(const [sport,type,home,away,sourceHome,sourceAway] of [
   ['NHL','hockey_match','Saint Louis Blues','New York Rangers','St. Louis Blues','NY Rangers'],
   ['NBA','basketball_game','Central Arkansas Bears','South Texas Hawks','C Arkansas Bears','S Texas Hawks'],
   ['NFL','football_game','Minnesota Vikings','Jacksonville Jaguars','Minn. Vikings','Jacksonville Jags'],
   ['Soccer','soccer_tournament_multi_leg','Manchester United','City Athletic','Man. Utd','City Ath.']
 ]){
  const {game,milestone}=mk(home,away,24,21,sport,type);
  const board={events:[event({home:sourceHome,away:sourceAway,homeShort:sourceHome,awayShort:sourceAway,
     homeScore:24,awayScore:21})]};
  assert.equal(espnMatches(board,game,milestone).length,1,sport+' both independently named teams');
 }
});

test('team mismatch, one-point score disagreement, wrong kickoff and swapped home-away stay disqualifying',async()=>{
 const {game,milestone}=mk('Northbridge Wndrs','Southport Utd',2,1);
 const conflicting=[
  event({away:'Different City Rovers',awayShort:'Different Rovers'}),
  event({homeScore:3}),
  event({date:'2026-11-21T18:00:00Z'}),
  event({home:'Southport Utd',away:'Northbridge Wndrs',homeShort:'Southport Utd',awayShort:'Northbridge Wndrs'})
 ];
 for(const [i,e] of conflicting.entries()){
  const matches=espnMatches({events:[e]},game,milestone);
  if(i===1){assert.equal(matches.length,0,'ordinary relaxed verification requires exact score');
    assert.equal(espnMatches({events:[e]},game,milestone,{identityOnly:true}).length,1,'dedicated preflight recognizes a mismatched fixture for veto');
    assert.equal(await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',fetcher:fetchBoard([e])}),false);
  }else assert.equal(matches.length,0,String(i));
 }
});

test('ambiguous equal-score fixtures cannot verify even when the abbreviations are plausible',async()=>{
 const {game,milestone}=mk('Northbridge Wndrs','Southport Utd',2,1);
 const matches=[event({id:'espn-1'}),event({id:'espn-2'})];
 assert.equal(espnMatches({events:matches},game,milestone).length,2);
 assert.equal(await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',fetcher:fetchBoard(matches)}),false);
});

test('matching one short team name and the same score does not authorize the wrong second opponent',()=>{
 const {game,milestone}=mk('Washington Eagles','Boston Ravens',14,7,'NFL','football_game');
 const board={events:[event({home:'Washington Commanders',homeShort:'WAS',away:'Boston Ravens',awayShort:'Boston Ravens',homeScore:14,awayScore:7})]};
 assert.equal(espnMatches(board,game,milestone).length,0);
});

test('relaxed matching applies to FOX only with original game, date and matched scores',()=>{
 const {game,milestone}=mk('Northbridge Wndrs','Southport Utd',2,1);
 const f={sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:'2ND 6:00',
  entityLink:{layout:{tokens:{id:'123',homeUri:'H',awayUri:'A'}}},
  upperTeam:{uri:'A',name:'Southport United',longName:'Southport United',shortName:'Southport United',score:1},
  lowerTeam:{uri:'H',name:'Northbridge Wanderers',longName:'Northbridge Wanderers',shortName:'Northbridge Wanderers',score:2}}]}]};
 assert.equal(foxMatches(f,game,milestone).length,1);
});