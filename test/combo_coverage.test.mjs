import test from 'node:test';
import assert from 'node:assert/strict';
import {nextComboBatch,comboPlannerScope,comboExclusionKey,comboGroupRejection} from '../src/combos.mjs';
const leg=(ticker,event=ticker)=>({market:{ticker,event_ticker:event,status:'active'},event:{event_ticker:event}});
const collection=(legs,extra={})=>({collection_ticker:'C',is_all_yes:true,is_single_market_per_event:true,
  size_min:2,size_max:0,associated_event_tickers:[...new Set(legs.map(l=>l.event.event_ticker))],...extra});
function exhaust(cs,legs,{budget=3,requiredTicker=null,excluded=new Set(),maxExamined=2048}={}){
 let cursor={},seen=new Set(),groups=[],passes=0;
 do{
  const result=nextComboBatch(cs,legs,{cursor,maxPlans:budget,requiredTicker,known:seen,excluded,maxExamined});
  cursor=JSON.parse(JSON.stringify(result.cursor));passes++;
  for(const group of result.plans){assert.equal(seen.has(group.groupKey),false);seen.add(group.groupKey);groups.push(group)}
  if(result.exhausted)return {groups,seen,cursor,passes};
  assert.ok(passes<10000,'planner must eventually exhaust the finite space');
 }while(true);
}
test('four held contracts exhaust all six pairs, four triples and one four-pick group once',()=>{
 const legs=['A','B','C','D'].map(t=>leg(t)),c=collection(legs);
 const r=exhaust([c],legs,{budget:2});
 assert.deepEqual([2,3,4].map(n=>r.groups.filter(p=>p.legs.length===n).length),[6,4,1]);
 assert.equal(r.seen.size,11);assert.ok(r.passes>1);
 assert.deepEqual(nextComboBatch([c],legs,{cursor:r.cursor,known:r.seen}).plans,[]);
});
test('all alternative-contract Cartesian choices are reached, not two diagonal pairs',()=>{
 const legs=[leg('A1','A'),leg('A2','A'),leg('B1','B'),leg('B2','B')],c=collection(legs);
 const r=exhaust([c],legs,{budget:1});
 assert.deepEqual(r.groups.map(p=>p.legs.map(l=>l.market.ticker).join('+')).sort(),['A1+B1','A1+B2','A2+B1','A2+B2']);
});
test('event alternatives cover every weighted pair and triple, and one-per-event rules remain enforced',()=>{
 const legs=[leg('A1','A'),leg('A2','A'),leg('B1','B'),leg('B2','B'),leg('B3','B'),leg('C1','C')];
 const r=exhaust([collection(legs)],legs);
 assert.equal(r.groups.filter(p=>p.legs.length===2).length,11);
 assert.equal(r.groups.filter(p=>p.legs.length===3).length,6);
 assert.ok(r.groups.every(p=>new Set(p.legs.map(l=>l.event.event_ticker)).size===p.legs.length));
});
test('same-event collections enumerate player subsets and an exact new-fill anchor is always included',()=>{
 const legs=['A','B','C','D'].map(t=>leg(t,'E')),c=collection(legs,{is_single_market_per_event:false});
 assert.equal(exhaust([c],legs).groups.length,11);
 const r=exhaust([c],legs,{requiredTicker:'D',budget:2});
 assert.equal(r.groups.length,7);assert.ok(r.groups.every(p=>p.legs.some(l=>l.market.ticker==='D')));
 assert.equal(exhaust([c],legs,{requiredTicker:'MISSING'}).groups.length,0);
});
test('canonical identity deduplicates permutations and overlapping collections across pages',()=>{
 const legs=['A','B','C','D'].map(t=>leg(t)),c=collection(legs);
 const one=exhaust([c,{...c,collection_ticker:'C2'}],legs,{budget:2});
 assert.equal(one.groups.length,11);
 assert.equal(comboExclusionKey(legs),comboExclusionKey([...legs].reverse()));
 assert.equal(comboPlannerScope([c],legs),comboPlannerScope([c],[...legs].reverse()));
 const reversed=nextComboBatch([c],[...legs].reverse(),{known:one.seen});assert.equal(reversed.plans.length,0);
});
test('limited batches reach every available size, including sizes beyond the RFQ batch limit',()=>{
 const legs=Array.from({length:18},(_,i)=>leg('L'+i)),c=collection(legs);
 let cursor={},seen=new Set(),sizes=new Set();
 for(let page=0;page<8;page++){
  const r=nextComboBatch([c],legs,{cursor,maxPlans:4,known:seen});cursor=JSON.parse(JSON.stringify(r.cursor));
  for(const g of r.plans){seen.add(g.groupKey);sizes.add(g.legs.length)}
 }
 assert.equal(sizes.size,17);assert.ok(sizes.has(2));assert.ok(sizes.has(18));
});
test('bounded examination advances through exclusions rather than resetting or silently skipping the tail',()=>{
 const legs=Array.from({length:8},(_,i)=>leg('L'+i)),c=collection(legs,{size_min:2,size_max:2});
 const all=exhaust([c],legs).groups,known=new Set(all.slice(0,27).map(p=>p.groupKey));
 let cursor={},found=[],calls=0;
 while(!found.length){const r=nextComboBatch([c],legs,{cursor,known,maxPlans:2,maxExamined:3});cursor=r.cursor;found=r.plans;calls++;if(r.exhausted)break;assert.ok(calls<20)}
 assert.equal(found.length,1);assert.ok(calls>1);
});
test('nineteen choices span all pairs across saved cursor pages without parity holes',()=>{
 const legs=Array.from({length:19},(_,i)=>leg('L'+i)),c=collection(legs,{size_max:4});
 const r=exhaust([c],legs,{budget:12});
 assert.equal(r.groups.filter(p=>p.legs.length===2).length,171);
 assert.equal(r.groups.filter(p=>p.legs.length===3).length,969);
 assert.equal(r.groups.filter(p=>p.legs.length===4).length,3876);
});
test('an excluded pair removes its supersets while unrelated sets remain reachable',()=>{
 const legs=['A','B','C','D'].map(t=>leg(t)),c=collection(legs),excluded=new Set([comboExclusionKey(legs.slice(0,2))]);
 const r=exhaust([c],legs,{excluded});
 assert.equal(r.groups.length,7);assert.ok(r.groups.every(g=>!g.legs.includes(legs[0])||!g.legs.includes(legs[1])));
});
