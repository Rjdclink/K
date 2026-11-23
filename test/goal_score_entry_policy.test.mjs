import test from 'node:test';
import assert from 'node:assert/strict';
import {goalScoreBelowFive} from '../src/final_five_entry.mjs';
import {assertExternalPurchase,rememberIndependentEntry} from '../src/entry_verification.mjs';

const market={ticker:'KXNHLGAME-TEST-HOME',event_ticker:'KXNHLGAME-TEST',rules_primary:'Home wins'};
const makeGame=(type,home,away)=>({
 id:'fixture:'+type,type,sport:type.startsWith('hockey_')?'NHL':'Soccer',
 verifiedLive:true,scoreKnown:true,periodConsistent:true,clockRunning:true,
 period:type.startsWith('hockey_')?3:2,
 remainingSeconds:240,soccerMinute:86,matchRemainingSeconds:240,
 home,away,verificationId:'independently-verified'
});
function evidence(type,home,away,external={home,away}){
 const game=makeGame(type,home,away),now=Date.now();
 game.externalScore={source:'ESPN',eventId:'unique-external-fixture',gameId:game.id,
   home:external.home,away:external.away,live:true,checkedAt:now};
 rememberIndependentEntry(game,market,game.verificationId,now);
 return {game,market};
}
const order=entries=>assertExternalPurchase('/portfolio/events/orders','POST',
 {ticker:entries[0].market.ticker,side:'bid',reduce_only:false},entries);

test('goal-score restriction uses combined game goals: four permitted, five and above blocked in hockey and soccer',()=>{
 for(const type of ['hockey_match','hockey_tournament','soccer_match','soccer_tournament_multi_leg']){
  for(const [home,away] of [[0,0],[4,0],[2,2]]) {
   const entry=evidence(type,home,away);
   assert.equal(goalScoreBelowFive(entry.game),true, type+' '+home+'-'+away);
   assert.doesNotThrow(()=>order([entry]),type+' '+home+'-'+away);
  }
  for(const [home,away] of [[5,0],[2,3],[3,3],[9,8]]){
   const entry=evidence(type,home,away);
   assert.equal(goalScoreBelowFive(entry.game),false,type+' '+home+'-'+away);
   assert.throws(()=>order([entry]),{code:'LOCAL_GOAL_SCORE_LIMIT'},type+' '+home+'-'+away);
  }
 }
});
test('either independently verified score or Kalshi game score may veto; both must be below five',()=>{
 for(const type of ['hockey_match','hockey_tournament','soccer_match','soccer_tournament_multi_leg']){
  const staleKalshi=evidence(type,2,2,{home:3,away:2});
  assert.throws(()=>order([staleKalshi]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const staleProvider=evidence(type,3,2,{home:1,away:1});
  assert.throws(()=>order([staleProvider]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const mismatch=evidence(type,1,2);
  mismatch.game.externalScore.gameId='different-game';
  assert.throws(()=>order([mismatch]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const noSource=evidence(type,1,2);
  delete noSource.game.externalScore;
  assert.throws(()=>order([noSource]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const invalid=evidence(type,1,2,{home:1.5,away:2});
  assert.throws(()=>order([invalid]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const expired=evidence(type,1,2);
  expired.game.externalScore.checkedAt=Date.now()-15001;
  assert.throws(()=>order([expired]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
 }
});
test('NO route carries independently matched scoreboard evidence and cannot trade at 5+ when Kalshi reads 4',()=>{
 for(const type of ['hockey_match','hockey_tournament','soccer_match','soccer_tournament_multi_leg']){
  const game=makeGame(type,2,2);
  const now=Date.now();
  rememberIndependentEntry(game,market,game.verificationId,now,undefined,{
   source:'ESPN',eventId:'independently-matched-final-score',home:3,away:2});
  assert.throws(()=>order([{game,market}]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
  const low=makeGame(type,2,2);
  rememberIndependentEntry(low,market,low.verificationId,Date.now(),undefined,{
   source:'ESPN',eventId:'independently-matched-final-score',home:2,away:2});
  assert.doesNotThrow(()=>order([{game:low,market}]));
 }
});
test('combinations recursively reject any high-scoring leg, preserving other sports and reduce-only position exits',()=>{
 const low=evidence('hockey_match',2,2);
 const high=evidence('soccer_match',3,2);
 const composite={id:'combo:test',verificationId:'combined',
   entryComponents:[low,high]};
 const combinedMarket={ticker:'KXMVE-TEST',event_ticker:'KXMVE-TEST',mve_selected_legs:[
   {market_ticker:low.market.ticker},{market_ticker:high.market.ticker}]};
 rememberIndependentEntry(composite,combinedMarket,composite.verificationId,Date.now());
 assert.throws(()=>assertExternalPurchase('/communications/rfqs/A/quotes/B/accept','PUT',
   {accepted_side:'no'},[{game:composite,market:combinedMarket}]),{code:'LOCAL_GOAL_SCORE_LIMIT'});
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
   {ticker:market.ticker,side:'ask',reduce_only:true},null));
 const other={...makeGame('football_game',15,12),sport:'NFL'};
 rememberIndependentEntry(other,market,other.verificationId,Date.now());
 assert.doesNotThrow(()=>order([{game:other,market}]));
});
test('all independent hockey and soccer NO routes preserve matched full-game scores in purchase evidence',async()=>{
 const source=await import('node:fs').then(m=>m.readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8'));
 for(const mode of ['independent_nhl_total_no','independent_soccer_full_game_total_no'])
  assert.match(source,new RegExp('mode:\\x27'+mode+'\\x27[\\s\\S]{0,600}?rememberIndependentEntry\\(fresh,current,verificationId,externalCheckedAt,undefined,proof\\)'));
 assert.match(source,/rememberIndependentEntry\(fresh,current,verificationId,externalCheckedAt,undefined,\s*\(hockey\|\|sport==='Soccer'\)\?proof:undefined\)/);
});