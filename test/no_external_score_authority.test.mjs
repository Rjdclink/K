import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchIndependentMatchScore,pairedExternalMatch} from '../src/independent_match_score.mjs';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo,collegeFootballTotalNo} from '../src/no_strategy.mjs';
import {soccerTotalNo} from '../src/soccer_total_no.mjs';

const start='2026-11-20T22:30:00Z';
const fixture={id:'external-score-game',type:'basketball_game',title:'Mercyhurst at Canisius',start_date:start,
 details:{league:'NCAAMB',main_game_event_ticker:'KXNCAAMBGAME-TEST'}};
const mk=(home=51,away=47,clock='6:18')=>gameState(fixture,{
 milestone_id:fixture.id,_observed_at:new Date().toISOString(),details:{
 status:'live',period:2,clock,home_points:home,away_points:away,
 home_team_name:'Canisius',away_team_name:'Mercyhurst',last_updated_ts:Date.now()/1000}});
const market=(line=133.5)=>({ticker:'KXNCAAMBTOTAL-TEST-'+line,event_ticker:'KXNCAAMBTOTAL-TEST',
 title:'Over '+line+' points',floor_strike:line,strike_type:'greater',status:'active',
 rules_primary:'Resolves Yes if over '+line+' total points are scored in the Mercyhurst vs Canisius basketball game.'});
const board=(home=48,away=43,id='401919827')=>({events:[{id,date:start,competitions:[{
 status:{period:2,type:{state:'in'},displayClock:'6:18'},
 competitors:[{homeAway:'home',score:String(home),team:{displayName:'Canisius Golden Griffins',shortDisplayName:'Canisius'}},
 {homeAway:'away',score:String(away),team:{displayName:'Mercyhurst Lakers',shortDisplayName:'Mercyhurst'}}]}]}]});
const fetcher=async()=>({ok:true,json:async()=>board()});

test('external ESPN scoreboard for Mercyhurst–Canisius remains authoritative despite different Kalshi score',async()=>{
 const state=mk();
 const proof=await fetchIndependentMatchScore(state,fixture,{espnFeed:'basketball/mens-college-basketball',fetcher,fixtureCache:null});
 assert.equal(proof?.eventId,'401919827');
 assert.deepEqual([proof.home,proof.away],[48,43]);
 assert.equal(collegeBasketballTotalNo(state,market(133.5)),null,'Kalshi 98 points fails 40-point margin');
 assert.equal(collegeBasketballTotalNo(state,market(133.5),{external:proof})?.total,91,
   'the 42.5-point cushion of external combined score 91 qualifies');
});
test('external score must block a cushion even where the Kalshi score alone would qualify',()=>{
 const state=mk(44,43); // Kalshi 87: 46.5 points of apparent cushion
 const verified={source:'ESPN',eventId:'401919827',gameId:state.id,home:51,away:47}; // external 98: only 35.5 points
 assert.ok(collegeBasketballTotalNo(state,market(133.5)));
 assert.equal(collegeBasketballTotalNo(state,market(133.5),{external:verified}),null);
});
test('two independent checks may disagree with Kalshi but cannot mismatch fixture or regress in score',()=>{
 const game=mk();
 const first={source:'ESPN',eventId:'401919827',gameId:game.id,home:48,away:43};
 assert.equal(pairedExternalMatch(first,{...first,home:49},game),true);
 assert.equal(pairedExternalMatch(first,{...first,home:47},game),false,'score must not run backward');
 assert.equal(pairedExternalMatch(first,{...first,eventId:'another-game'},game),false);
 assert.equal(pairedExternalMatch(first,{...first,gameId:'different'},game),false);
});
