import test from 'node:test';
import assert from 'node:assert/strict';
import {authoritativeGameState,externalStatScore,verifiedSourceReady} from '../src/external_authority.mjs';
import {leadSignal,overSignal} from '../src/strategy.mjs';

const game={
 id:'fixture-one',type:'basketball_game',sport:'NBA',verifiedLive:true,
 scoreKnown:true,scoreConsistent:true,periodConsistent:true,
 feedId:'fixture-one',home:100,away:100,homeUnits:100,awayUnits:100,
 homeName:'Home',awayName:'Away',homeTeamId:'home-id',awayTeamId:'away-id',
 period:4,remainingSeconds:90,clock:'1:30',unit:'points',observedAt:Date.now(),updatedAt:Date.now()-1000
};
const lead={ticker:'KXNBAGAME-GAME-HOME',event_ticker:'KXNBAGAME-GAME',status:'active',
 title:'Home wins',yes_sub_title:'Home',custom_strike:{basketball_team:'home-id'},
 rules_primary:'Home wins the game'};
const over={ticker:'KXNBATOTAL-GAME-215',event_ticker:'KXNBATOTAL-GAME',
 status:'active',title:'Over 214.5 total points',floor_strike:214.5,
 strike_type:'greater',rules_primary:'Combined total points scored in the full game'};
const proof=(home,away)=>({source:'ESPN',eventId:'espn-exact-1',gameId:game.id,
 home,away,period:4,live:true,
 periods:[{number:1,home:25,away:25},{number:2,home:25,away:25},
 {number:3,home:25,away:25},{number:4,home:home-75,away:away-75}]});

test('independent NBA score changes lead and OVER eligibility without changing Kalshi clock',()=>{
 const approved=authoritativeGameState(game,proof(120,94),Date.now());
 assert.equal(approved.home,120);assert.equal(approved.away,94);
 assert.equal(approved.remainingSeconds,90);assert.equal(approved.period,4);
 assert.equal(approved.kalshiScore.home,100);
 assert.equal(leadSignal(game,lead),null);
 assert.equal(leadSignal(approved,lead)?.strategy,'lead');
 assert.equal(overSignal(game,over),null);
 assert.equal(overSignal(approved,over),null,'source score 214 does not cross 214.5');
 const approved2=authoritativeGameState(game,proof(121,94),Date.now());
 assert.equal(overSignal(approved2,over)?.scored,215);
});
test('external score can reject an apparent Kalshi winner or crossing',()=>{
 const misleading={...game,home:120,away:94,homeUnits:120,awayUnits:94};
 assert.ok(leadSignal(misleading,lead));
 const verified=authoritativeGameState(misleading,proof(102,100));
 assert.equal(leadSignal(verified,lead),null);
});
test('wrong fixture, malformed score, stale source, mismatched period and invalid splits never become authoritative',()=>{
 const now=Date.now();
 for(const bad of [{...proof(120,94),gameId:'other'},{...proof(120,94),eventId:''},
  {...proof(120,94),home:-1},{...proof(120,94),live:false},
  {...proof(120,94),period:3},{...proof(120,94),periods:[{number:1,home:0,away:0}]}])
  assert.equal(authoritativeGameState(game,bad,now),null,JSON.stringify(bad));
 const verified=authoritativeGameState(game,proof(120,94),now);
 assert.equal(verifiedSourceReady(verified,now+16000),false);
 assert.equal(verifiedSourceReady(verified,now+3000),true);
});
test('a validated external player stat controls threshold, not a conflicting Kalshi player stat',()=>{
 const verified={source:'ESPN',gameId:game.id,eventId:'espn-exact-1',playerId:'p',metric:'PTS',playerValue:24};
 assert.equal(externalStatScore(game,verified,{id:'p',metric:'PTS',value:20,line:22.5}),24);
 assert.equal(externalStatScore(game,{...verified,playerValue:22},{id:'p',metric:'PTS',value:24,line:22.5}),null);
 assert.equal(externalStatScore(game,{...verified,eventId:''},{id:'p',metric:'PTS',value:20,line:22.5}),null);
});
