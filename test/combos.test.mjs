import test from 'node:test';
import assert from 'node:assert/strict';
import {COMBO_WINDOW_MS,VERIFY_DWELL_MS,comboAllocation,cashAfterComboReserve,comboCandidates,comboCollection,compatibleComboGroups,quoteForYes,comboLegs,filledComboWindow,eligibleFillTrigger,collectionsForEvents,selectedComboMarkets} from '../src/combos.mjs';

test('a stale newer fill cannot starve an older live combo trigger',()=>{
  const singles=[{id:'new',market_ticker:'NBA'},{id:'older',market_ticker:'Hubbard'}];
  const group=[{market:{ticker:'Hubbard'}},{market:{ticker:'Watson'}}];
  assert.equal(eligibleFillTrigger([{id:'new'},{id:'older'}],singles,group).market_ticker,'Hubbard');
});

test('single trades retain their own bankroll cap while cash is reserved for the next combo',()=>{
  assert.equal(cashAfterComboReserve(10227,14599,0),8768);
  assert.equal(cashAfterComboReserve(1478,14599,0),19);
  assert.equal(cashAfterComboReserve(1,14599,0),0);
  assert.equal(cashAfterComboReserve(10000,14599,1),8833);
});

test('Kalshi combo creation includes the side required by the live validator',()=>{
  const legs=[{event:{event_ticker:'E1'},market:{ticker:'M1'}},{event:{event_ticker:'E2'},market:{ticker:'M2'}}];
  assert.deepEqual(selectedComboMarkets(legs),[
    {event_ticker:'E1',market_ticker:'M1',side:'yes'},
    {event_ticker:'E2',market_ticker:'M2',side:'yes'}
  ]);
});
test('three held markets expose all three pairings and the full three-leg ticket',()=>{
  const legs=['Watson','Williams','Hubbard'].map(name=>({event:{event_ticker:'NFL-EVENT'},market:{ticker:name},milestone:{id:'NFL-GAME'},signal:{strategy:'over'}}));
  const collection={collection_ticker:'NFL-COMBO',is_all_yes:true,is_single_market_per_event:false,size_min:2,size_max:3,associated_event_tickers:['NFL-EVENT']};
  assert.deepEqual(compatibleComboGroups([collection],legs).map(g=>g.legs.map(l=>l.market.ticker)),[
    ['Watson','Williams','Hubbard'],['Watson','Williams'],['Watson','Hubbard'],['Williams','Hubbard']
  ]);
});

test('combo collection discovery filters by each event and paginates',async()=>{
  const requests=[];
  const collections=await collectionsForEvents(['E1','E2','E1'],async path=>{
    const q=new URL(path,'https://example.test').searchParams;
    requests.push([q.get('associated_event_ticker'),q.get('cursor')]);
    if(q.get('associated_event_ticker')==='E1'&&!q.get('cursor'))return {multivariate_contracts:[{collection_ticker:'C1'}],cursor:'next'};
    if(q.get('associated_event_ticker')==='E2')return {multivariate_contracts:[{collection_ticker:'C2'},{collection_ticker:'C1'}],cursor:''};
    return {multivariate_contracts:[{collection_ticker:'C3'}],cursor:''};
  });
  assert.deepEqual(collections.map(c=>c.collection_ticker),['C1','C3','C2']);
  assert.deepEqual(requests.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[['E1','next'],['E1',null],['E2',null]].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
});
const candidate=(id,event,strategy='over')=>({milestone:{id},event:{event_ticker:event},market:{ticker:id+'-YES'},signal:{strategy},state:{title:id,sport:'NBA'}});
test('each new filled combination lowers its bankroll allocation to a two percent floor',()=>{
  assert.equal(VERIFY_DWELL_MS,3000);
  assert.deepEqual(Array.from({length:7},(_,i)=>comboAllocation(i)),[.10,.08,.06,.04,.02,.02,.02]);
});
test('groups at most six distinct live games and distinct events by strategy',()=>{
  const input=[candidate('a','A'),candidate('a','B'),candidate('b','A'),...Array.from({length:8},(_,i)=>candidate('c'+i,'C'+i)),candidate('z','Z','lead')];
  assert.deepEqual(comboCandidates(input,'over').map(c=>c.milestone.id),['a','c0','c1','c2','c3','c4']);
  assert.equal(comboLegs(comboCandidates(input,'over')).length,6);
});
test('held fills remain eligible; the market ticker prevents a repeated combo order',()=>{
  const at=n=>new Date(1761690000000+n*1000).toISOString();
  const row=(n)=>({market_ticker:'M'+n,event_ticker:'E'+n,game_id:'G'+n,updated_at:at(n),combo_legs:null});
  const rows=[row(1),row(2),row(3)],held=new Set(rows.map(r=>r.market_ticker));
  assert.deepEqual(filledComboWindow(rows,held,null).map(r=>r.market_ticker),['M3','M2','M1']);
  assert.deepEqual(filledComboWindow([...rows,row(4)],new Set([...held,'M4']),at(3)).map(r=>r.market_ticker),['M4','M3','M2','M1']);
  assert.deepEqual(filledComboWindow([...rows,row(4),row(5)],new Set([...held,'M4','M5']),at(3)).map(r=>r.market_ticker),['M5','M4','M3','M2','M1']);
  assert.equal(filledComboWindow(Array.from({length:9},(_,i)=>row(i+1)),new Set(Array.from({length:9},(_,i)=>'M'+(i+1))),null).length,6);
  const props=Array.from({length:6},(_,i)=>({...row(i+10),game_id:'SAME-GAME',event_ticker:'PROP-'+i}));
  assert.equal(filledComboWindow(props,new Set(props.map(p=>p.market_ticker)),null).length,6);
});
test('combo searches compatible non-prefix pairs when the first candidate is outside a collection',()=>{
  const candidates=[candidate('a','A'),candidate('b','B'),candidate('c','C')];
  const collection={collection_ticker:'ALLYES',is_all_yes:false,functional_description:'The resulting market will only resolve to YES if every associated market resolves to YES.',is_single_market_per_event:true,size_min:2,size_max:3,associated_events:[{ticker:'B'},{ticker:'C'}]};
  assert.deepEqual(compatibleComboGroups([collection],candidates).map(g=>g.legs.map(l=>l.milestone.id)),[['b','c']]);
});
test('requires a compatible all-YES multivariate collection for every leg',()=>{
  const legs=[candidate('a','A'),candidate('b','B')];
  assert.equal(comboCollection([{is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:['A','B']}],legs)?.size_min,2);
  assert.ok(comboCollection([{is_all_yes:false,functional_description:'The resulting market will only resolve to YES if every associated market resolves to YES.',is_single_market_per_event:true,size_min:2,associated_events:[{ticker:'A'},{ticker:'B'}]}],legs));
  assert.equal(comboCollection([{is_all_yes:false,is_single_market_per_event:true,size_min:2,associated_events:[{ticker:'A'},{ticker:'B'}]}],legs),undefined);
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
  assert.ok(quoteForYes(small,'COMBO',1000,2,9900)?.profitCents>0);
});
test('same game and event picks require a collection explicitly allowing multiple markets per event',()=>{
 const legs=[candidate('a','A'),candidate('b','A')];
 const c={is_all_yes:true,is_single_market_per_event:false,size_min:2,size_max:6,associated_event_tickers:['A']};
 assert.ok(comboCollection([c],legs));assert.equal(comboCollection([{...c,is_single_market_per_event:true}],legs),undefined);
});
test('six independently filled player props from one game stay in the six-leg combo when the collection allows them',()=>{
 const candidates=Array.from({length:6},(_,i)=>candidate('same-game','PROP'+i));
 candidates.forEach((c,i)=>{c.market.ticker='PROP'+i+'-YES'});
 const collection={collection_ticker:'SIX',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
 const groups=compatibleComboGroups([collection],candidates,64);
 assert.equal(groups[0].legs.length,6);
 assert.deepEqual(groups[0].legs.map(c=>c.market.ticker),candidates.map(c=>c.market.ticker));
});

