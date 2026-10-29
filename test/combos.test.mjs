import test from 'node:test';
import assert from 'node:assert/strict';
import {COMBO_WINDOW_MS,comboCandidates,comboCollection,quoteForYes,comboLegs,filledComboWindow} from '../src/combos.mjs';
const candidate=(id,event,strategy='over')=>({milestone:{id},event:{event_ticker:event},market:{ticker:id+'-YES'},signal:{strategy},state:{title:id,sport:'NBA'}});
test('groups at most six distinct live games and distinct events by strategy',()=>{
  const input=[candidate('a','A'),candidate('a','B'),candidate('b','A'),...Array.from({length:8},(_,i)=>candidate('c'+i,'C'+i)),candidate('z','Z','lead')];
  assert.deepEqual(comboCandidates(input,'over').map(c=>c.milestone.id),['a','c0','c1','c2','c3','c4']);
  assert.equal(comboLegs(comboCandidates(input,'over')).length,6);
});
test('first combo uses held fills; later combo waits for two new fills and never repeats the same set',()=>{
  const at=n=>new Date(1761690000000+n*1000).toISOString();
  const row=(n)=>({market_ticker:'M'+n,event_ticker:'E'+n,game_id:'G'+n,updated_at:at(n),combo_legs:null});
  const rows=[row(1),row(2),row(3)],held=new Set(rows.map(r=>r.market_ticker));
  assert.deepEqual(filledComboWindow(rows,held,null).map(r=>r.market_ticker),['M3','M2','M1']);
  assert.deepEqual(filledComboWindow([...rows,row(4)],new Set([...held,'M4']),at(3)),[]);
  assert.deepEqual(filledComboWindow([...rows,row(4),row(5)],new Set([...held,'M4','M5']),at(3)).map(r=>r.market_ticker),['M5','M4','M3','M2','M1']);
  assert.equal(filledComboWindow(Array.from({length:9},(_,i)=>row(i+1)),new Set(Array.from({length:9},(_,i)=>'M'+(i+1))),null).length,6);
});
test('requires a compatible all-YES multivariate collection for every leg',()=>{
  const legs=[candidate('a','A'),candidate('b','B')];
  assert.equal(comboCollection([{is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:['A','B']}],legs)?.size_min,2);
  assert.equal(comboCollection([{is_all_yes:false,is_single_market_per_event:true,size_min:2,associated_event_tickers:['A','B']}],legs),undefined);
  assert.equal(comboCollection([{is_all_yes:true,is_single_market_per_event:true,size_min:2,associated_event_tickers:['A']}],legs),undefined);
});
test('accepts only fresh affordable positive net YES quotes, with maker NO bid as complement',()=>{
  const q={market_ticker:'COMBO',status:'open',no_bid_dollars:'0.1000',no_contracts_fp:'10.00',created_ts:new Date().toISOString()};
  const good=quoteForYes(q,'COMBO',1000,2);
  assert.equal(good.yesCost,.9);
  assert.ok(good.profitCents>0);
  assert.equal(quoteForYes(q,'COMBO',good.debitCents-1,2),null);
  assert.equal(quoteForYes({...q,status:'executed'},'COMBO',1000,2),null);
  assert.equal(quoteForYes({...q,created_ts:new Date(Date.now()-COMBO_WINDOW_MS-1000).toISOString()},'COMBO',1000,2),null);
  assert.equal(quoteForYes({...q,no_bid_dollars:'0.0001'},'COMBO',1000,2),null);
  const small={...q,no_contracts_fp:'3.00'};
  assert.ok(quoteForYes(small,'COMBO',1000,2,9900));
  assert.equal(quoteForYes(small,'COMBO',1000,2,10000),null);
});
test('same game and event picks require a collection explicitly allowing multiple markets per event',()=>{
 const legs=[candidate('a','A'),candidate('b','A')];
 const c={is_all_yes:true,is_single_market_per_event:false,size_min:2,size_max:6,associated_event_tickers:['A']};
 assert.ok(comboCollection([c],legs));assert.equal(comboCollection([{...c,is_single_market_per_event:true}],legs),undefined);
});
