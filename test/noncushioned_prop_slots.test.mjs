import test from 'node:test';import assert from 'node:assert/strict';
import {MAX_UNCUSHIONED_PLAYER_PROPS,NONCUSHIONED_PLAYER_TAG,openNoncushionedPlayerTickers,mayOpenNoncushionedPlayerProp,countablePlayerMarketTicker} from '../src/noncushioned_prop_slots.mjs';
const row=(i,status='filled',reason=NONCUSHIONED_PLAYER_TAG)=>({market_ticker:'PROP-'+i,status,reason});
const held=arr=>arr.map(i=>({ticker:'PROP-'+i,position_fp:'1.00'}));
test('five open non-cushioned props block the sixth, but settled positions release one immediately',()=>{
 assert.equal(MAX_UNCUSHIONED_PLAYER_PROPS,5);
 const attempts=[1,2,3,4,5].map(i=>row(i));
 assert.equal(openNoncushionedPlayerTickers(held([1,2,3,4,5]),attempts).size,5);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,2,3,4,5]),attempts,'PROP-6'),false);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,2,3,4]),attempts,'PROP-6'),false,'a sale does not free a settlement-reserved slot');
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,2,3,4]),attempts,'PROP-6',new Set(['PROP-5'])),true);
});
test('pending orders reserve capacity, but settled, unfilled, cushioned and variable entries do not',()=>{
 const attempts=[row(1),row(2,'reserved'),row(3,'retrying'),row(4,'check_order'),
 row(5,'filled','Verified cushioned OVER'),row(6,'filled','Variable player over'),
 row(7,'unfilled'),row(8,'rejected')];
 assert.equal(openNoncushionedPlayerTickers(held([1,5,6]),attempts,new Set(['PROP-7','PROP-8'])).size,4);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,5,6]),attempts,'PROP-9',new Set(['PROP-7','PROP-8'])),true);
 attempts.push(row(9,'combo_pending'));
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,5,6]),attempts,'PROP-10',new Set(['PROP-7','PROP-8'])),false);
});
test('duplicate attempts do not double count; uncertain position results fail closed',()=>{
 const a=[row(1),row(1,'reserved')];
 assert.equal(openNoncushionedPlayerTickers(held([1]),a).size,1);
 assert.equal(mayOpenNoncushionedPlayerProp(null,a,'PROP-2'),false);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1]),null,'PROP-2'),false);
});

test('independently placed live countable player positions consume slots, while confirmed cushioned overs and variable props do not',()=>{
 const held=[{ticker:'KXNBAREB-TEST-7',position_fp:'1.00'},
  {ticker:'KXNBASTL-TEST-2',position_fp:'1.00'},
  {ticker:'KXNBAPTS-TEST-20',position_fp:'1.00'}];
 assert.equal(countablePlayerMarketTicker('KXNBAREB-TEST-7'),true);
 assert.equal(countablePlayerMarketTicker('KXNBAPTS-TEST-20'),false);
 assert.deepEqual([...openNoncushionedPlayerTickers(held,[])].sort(),
  ['KXNBAREB-TEST-7','KXNBASTL-TEST-2']);
 const audited=[{market_ticker:'KXNBASTL-TEST-2',reason:'still crossed after removing 1 player-stat unit',status:'filled'}];
 assert.deepEqual([...openNoncushionedPlayerTickers(held,audited)],['KXNBAREB-TEST-7']);
});
