import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finalFiveEntryEligible,assertFinalFiveEntry,FINAL_FIVE_SECONDS} from '../src/final_five_entry.mjs';
import {assertExternalPurchase,rememberIndependentEntry} from '../src/entry_verification.mjs';

const soccer=(minute,opts={})=>({
 id:'soccer-one',type:'soccer_tournament_multi_leg',sport:'Soccer',verifiedLive:true,
 scoreKnown:true,scoreConsistent:true,periodConsistent:true,period:2,
 soccerMinute:minute,matchRemainingSeconds:Math.max(0,Math.round((90-minute)*60)),
 soccerExtraTime:false,soccerOvertime:false,clockRunning:true,...opts
});
const hockey=(period,seconds,opts={})=>({
 id:'hockey-one',type:'hockey_match',sport:'NHL',verifiedLive:true,scoreKnown:true,
 scoreConsistent:true,periodConsistent:true,period,remainingSeconds:seconds,clockRunning:true,...opts
});
const market=game=>({ticker:(game.type.startsWith('soccer_')?'KXMLSGAME-X-HOME':'KXNHLGAME-X-HOME'),
 event_ticker:(game.type.startsWith('soccer_')?'KXMLSGAME-X':'KXNHLGAME-X'),
 custom_strike:{}});
const proof=game=>{
 const m=market(game);game.verificationId='independent-verified';
 rememberIndependentEntry(game,m,game.verificationId,Date.now());
 return {game,market:m};
};

test('five-minute purchase window is a game-end boundary, not five minutes before any half or period',()=>{
 assert.equal(FINAL_FIVE_SECONDS,300);
 for(const minute of [40,44,70,79,84,84.99])assert.equal(finalFiveEntryEligible(soccer(minute)),false,minute);
 for(const minute of [85,86.5,89.9])assert.equal(finalFiveEntryEligible(soccer(minute)),true,minute);
 assert.equal(finalFiveEntryEligible(soccer(90)),false,'do not guess 90:00 is live stoppage');
 assert.equal(finalFiveEntryEligible(soccer(92)),true,'verified live 90+ regulation stoppage is included');
 assert.equal(finalFiveEntryEligible(soccer(92,{soccerExtraTime:true})),false);
 assert.equal(finalFiveEntryEligible(soccer(85,{period:1})),false);
 assert.equal(finalFiveEntryEligible(soccer(85,{verifiedLive:false})),false);
 assert.equal(finalFiveEntryEligible(soccer(NaN)),false);
 for(const [period,secs,pass] of [
  [1,30,false],[2,120,false],[3,301,false],[3,300,true],[3,270,true],[3,1,true],
  [3,0,false],[4,300,true],[4,100,true],[4,0,false],[5,120,false]
 ])assert.equal(finalFiveEntryEligible(hockey(period,secs)),pass,period+':'+secs);
 assert.equal(finalFiveEntryEligible(hockey(3,280,{verifiedLive:false})),false);
 assert.equal(finalFiveEntryEligible(hockey(3,NaN)),false);
 assert.equal(finalFiveEntryEligible({id:'football-one',type:'football_game',sport:'NFL'}),true);
});

test('purchase authorization blocks early soccer and hockey YES, NO and combination legs even with fresh independent proofs',()=>{
 const cases=[
  [soccer(84.5),'bid'],
  [soccer(84.5),'ask'],
  [hockey(1,120),'ask'],
  [hockey(2,60),'bid'],
  [hockey(3,301),'bid']
 ];
 for(const [game,side] of cases){
  const evidence=proof(game);
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',
   {ticker:evidence.market.ticker,side,reduce_only:false},[evidence]),
    e=>e.code==='LOCAL_FINAL_FIVE_WINDOW_REQUIRED',game.type+' '+side);
 }
 const combo=[proof(soccer(80)),proof(hockey(3,299))];
 assert.throws(()=>assertExternalPurchase('/communications/rfqs/1/quotes/2/accept',
  'PUT',{accepted_side:'no'},combo),
  e=>e.code==='LOCAL_FINAL_FIVE_WINDOW_REQUIRED');
});

test('a single composite combo proof cannot conceal any early soccer/hockey underlying component',()=>{
 const early=proof(soccer(80)),late=proof(hockey(3,150));
 const composite={game:{
  id:'combo:exact',entryComponents:[early,late],verificationId:'verified-combo'
 },market:{ticker:'COMBO-A',event_ticker:'KXMVE-X'}};
 rememberIndependentEntry(composite.game,composite.market,'verified-combo',Date.now());
 assert.throws(()=>assertExternalPurchase('/communications/rfqs/1/quotes/2/accept','PUT',
  {accepted_side:'no'},[composite]),e=>e.code==='LOCAL_FINAL_FIVE_WINDOW_REQUIRED');
 const safe={...composite.game,entryComponents:[proof(soccer(88)),late],
  verificationId:'verified-combo-safe'};
 const m={...composite.market,ticker:'COMBO-B'};
 rememberIndependentEntry(safe,m,'verified-combo-safe',Date.now());
 assert.doesNotThrow(()=>assertExternalPurchase('/communications/rfqs/1/quotes/2/accept',
   'PUT',{accepted_side:'no'},[{game:safe,market:m}]));
});

test('fresh independently proven entries INSIDE the final five minutes remain allowed, including regulation stoppage',()=>{
 for(const game of [soccer(85),soccer(88),soccer(91),hockey(3,300),hockey(4,240)]){
  const evidence=proof(game);
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
   {ticker:evidence.market.ticker,side:'bid'},[evidence]));
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
   {ticker:evidence.market.ticker,side:'ask',reduce_only:false},[evidence]));
 }
});

test('reduce-only protective sells, held positions and football orders are unchanged',()=>{
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
  {ticker:market(soccer(65)).ticker,side:'ask',reduce_only:true},null));
 // Closing an existing NO position buys YES but is explicitly reduce-only.
 // It must never be mistaken for opening a new early hockey/soccer entry.
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
   {ticker:market(hockey(1,800)).ticker,side:'bid',reduce_only:true},null));
 const football={id:'football',type:'football_game',sport:'NFL',verifiedLive:true};
 const e=proof(football);
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',
  {ticker:e.market.ticker,side:'bid'},[e]));
});

test('the five-minute protection runs at the shared exchange purchase dispatch, not just strategy selection',()=>{
 const src=readFileSync(new URL('../src/entry_verification.mjs',import.meta.url),'utf8');
 assert.match(src,/assertFinalFiveEntry/);
 const index=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(index,/assertExternalPurchase\(path,method,opts\.body,opts\.entryVerifications\)/);
 assert.match(index,/async function submit/);
 assert.match(index,/async function recoverPending/);
 assert.match(index,/async function reserve\([^\n]+\{[\s\S]*?finalFiveEntryEligible\(game\)/);
 assert.match(index,/async function submit\([^\n]+\{[\s\S]*?finalFiveEntryEligible\(game\)/);
 assert.match(index,/async function recoverPending\([^\n]+\{[\s\S]*?finalFiveEntryEligible\(game\)/);
});


test('due-final NO candidates that cannot enter before game-end five minutes never start final market verification',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const hockey=src.slice(src.indexOf('async function scanHockeyTotalNos('),
   src.indexOf('async function scanEarlyPeriodNos('));
 const soccer=src.slice(src.indexOf('async function scanSoccerTotalNos('),
   src.indexOf('async function scanNoncushionedPlayerOvers('));
 const early=src.slice(src.indexOf('async function scanEarlyPeriodNos('),
   src.indexOf('async function scanSoccerTotalNos('));
 assert.match(hockey,/if\(phase==='final'\)watching=watching\.filter\(g=>finalFiveEntryEligible\(g\.state\)\)/);
 assert.match(soccer,/if\(phase==='final'\)watching=watching\.filter\(g=>finalFiveEntryEligible\(g\.state\)\)/);
 assert.match(early,/if\(phase==='final'&&\(hockey\|\|sport==='Soccer'\)\)return 0;/);
});
