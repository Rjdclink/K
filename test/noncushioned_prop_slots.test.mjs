import test from 'node:test';import assert from 'node:assert/strict';
import {MAX_UNCUSHIONED_PLAYER_PROPS,NONCUSHIONED_PLAYER_TAG,openNoncushionedPlayerTickers,mayOpenNoncushionedPlayerProp} from '../src/noncushioned_prop_slots.mjs';
const row=(i,status='filled',reason=NONCUSHIONED_PLAYER_TAG)=>({market_ticker:'PROP-'+i,status,reason});
const held=arr=>arr.map(i=>({ticker:'PROP-'+i,position_fp:'1.00'}));
test('five open non-cushioned props block the sixth, but settled positions release one immediately',()=>{
 assert.equal(MAX_UNCUSHIONED_PLAYER_PROPS,5);
 const attempts=[1,2,3,4,5].map(i=>row(i));
 assert.equal(openNoncushionedPlayerTickers(held([1,2,3,4,5]),attempts).size,5);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,2,3,4,5]),attempts,'PROP-6'),false);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,2,3,4]),attempts,'PROP-6'),true);
});
test('pending orders reserve capacity, but settled, unfilled, cushioned and variable entries do not',()=>{
 const attempts=[row(1),row(2,'reserved'),row(3,'retrying'),row(4,'check_order'),
 row(5,'filled','Verified cushioned OVER'),row(6,'filled','Variable player over'),
 row(7,'unfilled'),row(8,'rejected')];
 assert.equal(openNoncushionedPlayerTickers(held([1,5,6]),attempts).size,4);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,5,6]),attempts,'PROP-9'),true);
 attempts.push(row(9,'combo_pending'));
 assert.equal(mayOpenNoncushionedPlayerProp(held([1,5,6]),attempts,'PROP-10'),false);
});
test('duplicate attempts do not double count; uncertain position results fail closed',()=>{
 const a=[row(1),row(1,'reserved')];
 assert.equal(openNoncushionedPlayerTickers(held([1]),a).size,1);
 assert.equal(mayOpenNoncushionedPlayerProp(null,a,'PROP-2'),false);
 assert.equal(mayOpenNoncushionedPlayerProp(held([1]),null,'PROP-2'),false);
});
