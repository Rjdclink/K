import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entryExclusionReason,allowsNewEntry,assertNewEntryAllowed} from '../src/entry_exclusions.mjs';
import {assertExternalPurchase,rememberIndependentEntry} from '../src/entry_verification.mjs';

const market=(series='KXNHLTOTAL',custom_strike={})=>({
 ticker:series+'-26NOV23TEST-YES',event_ticker:series+'-26NOV23TEST',custom_strike,
 rules_primary:'Normal game contract',status:'active'
});
const game=(type='hockey_match',sport='NHL')=>({id:'g',type,sport,verificationId:'proof'});
function verified(g,m){
 rememberIndependentEntry(g,m,g.verificationId,Date.now());
 return [{game:g,market:m}];
}
test('all basketball games prohibit new purchases, including college, pro, international and esports',()=>{
 for(const [type,sport] of [['basketball_game','NBA'],['basketball_game','WNBA'],['basketball_game','NCAAB'],['basketball_game','NCAAW'],['basketball_game','China CBA'],['esports_match','eBasketball']]){
  assert.match(entryExclusionReason(game(type,sport),market('KXNBAGAME')),/basketball/i);
 }
 for(const sport of ['NBA','WNBA','NCAAB','NCAAW','Basketball']){
  assert.match(entryExclusionReason({sport},market('KXSPORTSGAME')),/basketball/i);
 }
 assert.match(entryExclusionReason(null,market('KXNCAAMBGAME')),/basketball/i);
 assert.match(entryExclusionReason(null,market('KXWNBAGAME')),/basketball/i);
});
test('all player-stat market families prohibit purchases, even without live player statistics',()=>{
 for(const metric of ['PTS','PRA','REB','AST','3PT','BLK','STL','PASSYDS','RUSHYDS','RECYDS','RRYDS','GOALS','SAVES','SOG','HITS','RBI','HR','PASSATT','RECPROT']){
  const m=market('KXNFL'+metric,{football_player:'p'});
  assert.match(entryExclusionReason(game('football_game','NFL'),m),/player prop/i,metric);
 }
 assert.match(entryExclusionReason(game('hockey_match','NHL'),market('KXNHLREB')),/player prop/i);
 assert.match(entryExclusionReason(game('football_game','NFL'),market('KXNFLGAME',{player_id:'p'})),/player prop/i);
 assert.match(entryExclusionReason(game('soccer_match','Soccer'),market('KXEPLGAME',{soccer_player:'p'})),/player prop/i);
});
test('normal football, hockey and soccer totals and winners remain eligible',()=>{
 for(const [type,sport,series] of [['football_game','NFL','KXNFLTOTAL'],['football_game','CFB','KXNCAAFGAME'],['hockey_match','NHL','KXNHLTOTAL'],['soccer_match','Soccer','KXEPLGAME'],['soccer_match','Soccer','KXEPLTEAMTOTAL']]){
  assert.equal(entryExclusionReason(game(type,sport),market(series)),null,series);
  assert.equal(allowsNewEntry(game(type,sport),market(series)),true);
  assert.doesNotThrow(()=>assertNewEntryAllowed(game(type,sport),market(series)));
 }
});
test('combination creation and add-ons reject every disallowed basketball or player-stat leg',()=>{
 const leg1={state:game('football_game','NFL'),market:market('KXNFLGAME')};
 const leg2={state:game('basketball_game','NBA'),market:market('KXNBAGAME')};
 const leg3={state:game('hockey_match','NHL'),market:market('KXNHLGOALS',{hockey_player:'p'})};
 assert.equal(entryExclusionReason(null,market('KXMVECROSSCATEGORY'),[leg1]),null);
 assert.match(entryExclusionReason(null,market('KXMVECROSSCATEGORY'),[leg1,leg2]),/basketball/i);
 assert.match(entryExclusionReason(null,market('KXMVECROSSCATEGORY'),[leg1,leg3]),/player prop/i);
 const synthetic=market('KXMVECROSSCATEGORY');
 synthetic.mve_selected_legs=[{market_ticker:leg2.market.ticker,side:'yes'}];
 assert.match(entryExclusionReason(null,synthetic),/basketball/i);
});
test('final Kalshi single-order pre-dispatch rejects restricted entries and preserves normal verified entries',()=>{
 for(const [g,m] of [[game('basketball_game','NBA'),market('KXNBAGAME')],
                    [game('football_game','NFL'),market('KXNFLRECYDS',{football_player:'p'})]]){
  const entries=verified(g,m);
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:m.ticker,side:'bid'},entries),{code:'LOCAL_ENTRY_EXCLUDED'});
 }
 const g=game('hockey_match','NHL'),m=market('KXNHLTOTAL');
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:m.ticker,side:'bid'},verified(g,m)));
});
test('exits and position-reducing orders remain untouched regardless of sport',()=>{
 for(const [g,m] of [[game('basketball_game','NBA'),market('KXNBAGAME')],
                     [game('football_game','NFL'),market('KXNFLRECYDS',{football_player:'p'})]]){
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:m.ticker,side:'ask',reduce_only:true},null));
 }
});
test('scanner routes retain all four display sports but block new basketball and player entry scanning',()=>{
 const code=requireIndex();
 assert.ok(code.includes('const ready=prioritizeNearCheckGames(candidates.filter(g=>allowsNewEntry(g.state,null)),8);'));
 assert.ok(code.includes('allCandidates.push(...candidates.filter(c=>!filled.has(signalKey(c))&&allowsNewEntry(c.state,c.market)))'));
 assert.ok(code.includes('o.new_entry_allowed=allowsNewEntry('));
 assert.ok(code.includes('execution:!allowsNewEntry(c.state,c.market)'));
 assert.ok(code.includes('if(allowsNewEntry(c.state,c.market)&&(upgradeEligible('));
 const main=code.slice(code.indexOf('async function scan(cachedMilestones'),code.indexOf('async function handleRequest('));
 for(const fragment of ['submitted+=await scanVariablePlayerOvers','submitted+=await scanNoncushionedPlayerOvers',
   'submitted+=await scanThirdQuarterNos',"'basketball',basketballNoSignals,'final'",
   "'basketball',basketballNoSignals,'initial'"])
   assert.ok(!main.includes(fragment),'prohibited production route: '+fragment);
});
function requireIndex(){return readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8')}

test('the final Kalshi combo RFQ acceptance rejects excluded component contracts',()=>{
 const component=market('KXNHLGOALS',{hockey_player:'player-1'});
 const componentGame=game('hockey_match','NHL');
 const group=market('KXMVESPORTS');
 group.mve_selected_legs=[{event_ticker:component.event_ticker,market_ticker:component.ticker,side:'yes'}];
 const comboGame={id:'combo',verificationId:'combo-verification',entryComponents:[{game:componentGame,market:component}]};
 rememberIndependentEntry(comboGame,group,comboGame.verificationId,Date.now());
 const entries=[{game:comboGame,market:group}];
 assert.throws(()=>assertExternalPurchase('/communications/rfqs/R/quotes/Q/accept','PUT',{accepted_side:'no'},entries),{code:'LOCAL_ENTRY_EXCLUDED'});
 const normal=market('KXNHLTOTAL');
 group.mve_selected_legs=[{event_ticker:normal.event_ticker,market_ticker:normal.ticker,side:'yes'}];
 comboGame.entryComponents=[{game:componentGame,market:normal}];
 rememberIndependentEntry(comboGame,group,comboGame.verificationId,Date.now());
 assert.doesNotThrow(()=>assertExternalPurchase('/communications/rfqs/R/quotes/Q/accept','PUT',{accepted_side:'no'},entries));
});
