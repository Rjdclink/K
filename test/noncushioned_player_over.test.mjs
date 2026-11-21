import test from 'node:test';import assert from 'node:assert/strict';
import {uncushionedPlayerSpec,noncushionedPlayerState,noncushionedTwoProofs,FIRST_NONCUSHIONED_CHECK_MS} from '../src/noncushioned_player_over.mjs';
const now=Date.now();
const game={id:'b1',type:'basketball_game',sport:'NBA',verifiedLive:true,scoreKnown:true,scoreConsistent:true,
 periodConsistent:true,period:1,remainingSeconds:600,feedId:'b1',observedAt:now,updatedAt:now-1000,
 home:40,away:39,playerStats:{p:{rebounds:6}},};
const market={ticker:'KXNBAREB-TEST-6',event_ticker:'KXNBAREB-TEST',title:'Pat: 7+ rebounds',
 yes_sub_title:'Pat: 7+',floor_strike:6.5,status:'active',strike_type:'greater',
 custom_strike:{basketball_player:'p'},rules_primary:'If Pat has 7 or more rebounds, market resolves Yes.'};
const proof=(n,at)=>({source:'ESPN',eventId:'espn-123',gameId:game.id,playerId:'p',metric:'REB',playerValue:n,
 contractKey:uncushionedPlayerSpec(game,market).key,requestedAt:at});
test('uncushioned player OVER can cross externally without Kalshi showing the crossing',()=>{
 assert.equal(FIRST_NONCUSHIONED_CHECK_MS,210000);
 assert.ok(uncushionedPlayerSpec(game,market));
 const result=noncushionedPlayerState(game,market,proof(7,now));
 assert.equal(result?.playerStats.p.rebounds,7);
 assert.equal(game.playerStats.p.rebounds,6,'Kalshi raw state remains unchanged');
});
test('two separate independent source reads, not one or regressed statistics, authorize entry',()=>{
 const first=proof(7,now-5000),last=proof(8,now);
 assert.equal(noncushionedTwoProofs(first,last,game,market,now),true);
 assert.equal(noncushionedTwoProofs(first,{...last,eventId:'other'},game,market,now),false);
 assert.equal(noncushionedTwoProofs(first,{...last,playerValue:6},game,market,now),false);
 assert.equal(noncushionedTwoProofs(first,{...last,requestedAt:first.requestedAt},game,market,now),false);
 assert.equal(noncushionedTwoProofs(first,{...last,requestedAt:now-12000},game,market,now),false);
});
test('variable value props and wrong player/market identity cannot enter uncushioned route',()=>{
 const variable={...market,event_ticker:'KXNBAPTS-TEST',ticker:'KXNBAPTS-TEST-6'};
 assert.equal(uncushionedPlayerSpec(game,variable),null);
 assert.equal(noncushionedPlayerState(game,market,{...proof(7,now),playerId:'x'}),null);
});
