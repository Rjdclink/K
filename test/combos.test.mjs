import test from 'node:test';
import assert from 'node:assert/strict';
import {VERIFY_DWELL_MS,COMBO_RFQ_PLANS,comboAllocation,comboLegAllocation,comboAllowedCents,comboRfqTargetCents,remainingVerifiedComboCents,availableComboFills,comboCandidates,comboCollection,compatibleComboGroups,prioritizedComboGroups,plannedComboGroups,comboPairDiagnostics,quoteForYes,comboLegs,filledComboWindow,eligibleFillTrigger,heldComboLeg,collectionsForEvents,selectedComboMarkets,liveComboMarket,missingQuoteFill} from '../src/combos.mjs';

test('an expired RFQ quote is reconciled from exact market buy fills before retiring its pending combo',()=>{
  const fills=[
    {ticker:'OTHER',order_id:'elsewhere',action:'buy',outcome_side:'yes',count_fp:'3.00',created_time:'2026-10-31T16:58:25Z'},
    {ticker:'COMBO',order_id:'accepted',action:'buy',outcome_side:'yes',count_fp:'2.00',created_time:'2026-10-31T16:58:26Z'},
    {ticker:'COMBO',order_id:'accepted',action:'buy',outcome_side:'yes',count_fp:'1.50',created_time:'2026-10-31T16:58:27Z'}
  ];
  assert.deepEqual(missingQuoteFill(fills,'COMBO','2026-10-31T16:58:24Z'),{orderId:'accepted',count:3.5});
  assert.equal(missingQuoteFill(fills.slice(0,1),'COMBO','2026-10-31T16:58:24Z'),null);
  assert.equal(missingQuoteFill([{...fills[1],created_time:'2026-10-31T16:58:00Z'}],'COMBO','2026-10-31T16:58:24Z'),null);
});

test('two held fills qualify for combo without a second live game verification',()=>{
  const rows=['A','B'].map(ticker=>({market_ticker:ticker,event_ticker:'E',game_id:'G',sport:'NFL',strategy:'over',fill_count:'2.00',combo_legs:null,updated_at:new Date().toISOString()}));
  const held=new Set(['A','B']);
  const legs=filledComboWindow(rows,held,null).map(row=>heldComboLeg(row,{ticker:row.market_ticker,event_ticker:'E',status:'active'},{}));
  assert.equal(legs.length,2);
  assert.ok(legs.every(Boolean));
  assert.equal(heldComboLeg(rows[0],{ticker:'A',event_ticker:'E',status:'closed'}),null);
  assert.equal(heldComboLeg({...rows[0],fill_count:'0'},{ticker:'A',event_ticker:'E',status:'active'}),null);
  assert.deepEqual(filledComboWindow(rows,new Set(['A']),null),[]);
});
test('held singles can be combo legs except the retired cricket lead signal',()=>{
  const rows=[
    {market_ticker:'A',reason:'Restricted 2% lead: Alpha leads',strategy:'lead',fill_count:1,event_ticker:'E'},
    {market_ticker:'B',reason:'Restricted 5% draw at 0–0',strategy:'lead',fill_count:1,event_ticker:'E'},
    {market_ticker:'C',reason:'Restricted 20% cricket final innings 4',strategy:'lead',fill_count:1,event_ticker:'E'},
    {market_ticker:'D',reason:'Ordinary lead',strategy:'lead',fill_count:1,event_ticker:'E'},
    {market_ticker:'E',reason:'Ordinary lead',strategy:'lead',fill_count:1,event_ticker:'E'}
  ];
  assert.deepEqual(availableComboFills(rows,new Set()),rows.filter(r=>r.market_ticker!=='C'));
  assert.deepEqual(filledComboWindow(rows,new Set(rows.map(r=>r.market_ticker)),null),rows);
  for(const row of rows.slice(0,2))assert.ok(heldComboLeg(row,{ticker:row.market_ticker,event_ticker:'E',status:'active'}));
  assert.equal(heldComboLeg(rows[2],{ticker:'C',event_ticker:'E',status:'active'}),null);
  const candidates=rows.map((row,i)=>({milestone:{id:'G'+i},event:{event_ticker:'E'+i},market:{ticker:row.market_ticker},signal:{strategy:'lead',comboEligible:i>=3}}));
  assert.deepEqual(comboCandidates(candidates,'lead'),candidates);
});
test('a soccer total corrected below its line cannot be added to a new combo',()=>{
  const row={market_ticker:'KXFOOTOTAL-MATCH-4',event_ticker:'KXFOOTOTAL-MATCH',strategy:'over',fill_count:'4.57',game_id:'match'};
  const market={ticker:row.market_ticker,event_ticker:row.event_ticker,status:'active',floor_strike:3.5};
  const snapshot={sport_family:'soccer_tournament_multi_leg',status:'live',scanned_at:new Date().toISOString(),home:3,away:0};
  assert.equal(heldComboLeg(row,market,snapshot),null);
  assert.ok(heldComboLeg(row,market,{...snapshot,away:1}));
  assert.equal(heldComboLeg(row,market,{...snapshot,scanned_at:new Date(Date.now()-91000).toISOString()}),null);
  assert.equal(heldComboLeg(row,market,{...snapshot,away:null}),null);
});

test('a stale newer fill cannot starve an older live combo trigger',()=>{
  const singles=[{id:'new',market_ticker:'NBA'},{id:'older',market_ticker:'Hubbard'}];
  const group=[{market:{ticker:'Hubbard'}},{market:{ticker:'Watson'}}];
  assert.equal(eligibleFillTrigger([{id:'new'},{id:'older'}],singles,group).market_ticker,'Hubbard');
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
test('winner combinations use twenty percent when all legs are independently verified',()=>{
  assert.equal(VERIFY_DWELL_MS,10000);
  assert.deepEqual(Array.from({length:7},(_,i)=>comboAllocation(i)),Array(7).fill(.20));
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
  assert.equal(filledComboWindow(Array.from({length:9},(_,i)=>row(i+1)),new Set(Array.from({length:9},(_,i)=>'M'+(i+1))),null).length,9);
  const props=Array.from({length:6},(_,i)=>({...row(i+10),game_id:'SAME-GAME',event_ticker:'PROP-'+i}));
  assert.equal(filledComboWindow(props,new Set(props.map(p=>p.market_ticker)),null).length,6);
});
test('verified winner combinations use twenty percent, fallback winners ten',()=>{
  const rows=[
    {strategy:'lead',market_ticker:'UNVERIFIED',reason:'Winner; Kalshi-only newer score check, 10 seconds apart',combo_legs:null},
    {strategy:'lead',market_ticker:'VERIFIED',reason:'Winner; independent score confirmed',combo_legs:null},
    {strategy:'lead',market_ticker:'VERIFIED2',reason:'Winner; independent score confirmed',combo_legs:null}
  ];
  assert.deepEqual(filledComboWindow(rows,new Set(rows.map(r=>r.market_ticker)),null),rows);
  const fallback=heldComboLeg({...rows[0],fill_count:'1',event_ticker:'E'}, {ticker:'UNVERIFIED',event_ticker:'E',status:'active'});
  const verified=heldComboLeg({...rows[1],fill_count:'1',event_ticker:'E'}, {ticker:'VERIFIED',event_ticker:'E',status:'active'});
  assert.equal(comboLegAllocation([fallback,verified],comboAllocation(0)),.10);
  assert.equal(comboLegAllocation([fallback,verified],comboAllocation(4)),.10);
  assert.equal(comboLegAllocation([verified],comboAllocation(0)),.20);
  assert.deepEqual(availableComboFills(rows,new Set(['UNVERIFIED'])),[rows[1],rows[2]],'a used unverified leg cannot stack another combo');
  assert.deepEqual(availableComboFills([{...rows[0],externally_verified:true},rows[1]],new Set(['UNVERIFIED'])).map(r=>r.market_ticker),['UNVERIFIED','VERIFIED']);
});
test('even fresh independently verified robust overs keep the ten percent combo ceiling',()=>{
  const market={ticker:'A',event_ticker:'E',status:'active'},reason='169 scored; line 139.5 already passed; still crossed if the latest 2-unit scoring play is removed';
  const snapshot={status:'live',scanned_at:new Date().toISOString(),signals:[{ticker:'A',reason}]};
  const row={market_ticker:'A',event_ticker:'E',game_id:'G',sport:'Basketball',strategy:'over',fraction:.40,fill_count:'2',reason};
  const robust=heldComboLeg(row,market,snapshot);
  assert.equal(robust.signal.robustOver,true);
  assert.equal(comboLegAllocation([robust,{...robust}],.50),.10);
  assert.equal(comboLegAllocation([robust,{...robust,signal:{...robust.signal,kalshiOnly:true,externallyVerified:false}}],.50),.10);
  assert.equal(heldComboLeg(row,market,{...snapshot,scanned_at:'2020-01-01T00:00:00Z'}).signal.robustOver,false);
});
test('a Kalshi-only single joins combinations only after current independent verification',()=>{
  const rows=[{id:'a',strategy:'lead',market_ticker:'A',reason:'Kalshi-only two reads',externally_verified:true,updated_at:'2026-10-30T12:00:00Z'},
    {id:'b',strategy:'lead',market_ticker:'B',reason:'independent',updated_at:'2026-10-30T12:00:00Z'}];
  assert.deepEqual(filledComboWindow(rows,new Set(['A','B']),null).map(r=>r.market_ticker),['A','B']);
  const fallback=heldComboLeg({...rows[0],fill_count:'1',event_ticker:'E'}, {ticker:'A',event_ticker:'E',status:'active'});
  const verified=heldComboLeg({...rows[0],fill_count:'1',event_ticker:'E',externally_verified:false}, {ticker:'A',event_ticker:'E',status:'active'});
  assert.equal(comboLegAllocation([fallback],.50),.20);
  assert.equal(comboLegAllocation([verified],.50),.10);
});
test('later verified combo add-on uses only remaining market exposure and fees',()=>{
  const position={position_fp:'20',market_exposure_dollars:'9.75',fees_paid_dollars:'0.25'};
  assert.equal(remainingVerifiedComboCents(position,10000),0);
  assert.equal(remainingVerifiedComboCents(position,20000),1000);
  assert.equal(remainingVerifiedComboCents(position,4000),0);
  assert.equal(remainingVerifiedComboCents({...position,fees_paid_dollars:null},10000),0);
});
test('combo searches compatible non-prefix pairs when the first candidate is outside a collection',()=>{
  const candidates=[candidate('a','A'),candidate('b','B'),candidate('c','C')];
  const collection={collection_ticker:'ALLYES',is_all_yes:false,functional_description:'The resulting market will only resolve to YES if every associated market resolves to YES.',is_single_market_per_event:true,size_min:2,size_max:3,associated_events:[{ticker:'B'},{ticker:'C'}]};
  assert.deepEqual(compatibleComboGroups([collection],candidates).map(g=>g.legs.map(l=>l.milestone.id)),[['b','c']]);
});
test('all three pair possibilities are diagnosed independently',()=>{
  const legs=[candidate('saudi','S'),candidate('qatar','Q'),candidate('turkey','T')];
  const collection={collection_ticker:'SAUDI-ONLY',is_all_yes:true,is_single_market_per_event:true,size_min:2,associated_event_tickers:['S']};
  assert.deepEqual(comboPairDiagnostics([collection],legs).map(p=>p.tickers),[
    ['qatar-YES','saudi-YES'],['saudi-YES','turkey-YES'],['qatar-YES','turkey-YES']]);
  assert.ok(comboPairDiagnostics([collection],legs).every(p=>p.collection===null));
});
test('requires a compatible all-YES multivariate collection for every leg',()=>{
  const legs=[candidate('a','A'),candidate('b','B')];
  assert.equal(comboCollection([{is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:['A','B']}],legs)?.size_min,2);
  assert.ok(comboCollection([{is_all_yes:false,functional_description:'The resulting market will only resolve to YES if every associated market resolves to YES.',is_single_market_per_event:true,size_min:2,associated_events:[{ticker:'A'},{ticker:'B'}]}],legs));
  assert.equal(comboCollection([{is_all_yes:false,is_single_market_per_event:true,size_min:2,associated_events:[{ticker:'A'},{ticker:'B'}]}],legs),undefined);
  assert.equal(comboCollection([{is_all_yes:true,is_single_market_per_event:true,size_min:2,associated_event_tickers:['A']}],legs),undefined);
});
test('accepts open affordable positive net YES quotes, with maker NO bid as complement',()=>{
  const q={market_ticker:'COMBO',status:'open',no_bid_dollars:'0.1000',no_contracts_fp:'10.00',created_ts:new Date().toISOString()};
  const good=quoteForYes(q,'COMBO',1000,2);
  assert.equal(good.yesCost,.9);
  assert.ok(good.profitCents>0);
  assert.equal(quoteForYes(q,'COMBO',good.debitCents-1,2),null);
  assert.equal(quoteForYes({...q,status:'executed'},'COMBO',1000,2),null);
  assert.ok(quoteForYes({...q,created_ts:new Date(Date.now()-13000).toISOString()},'COMBO',1000,2),'an open quote does not expire just because it was created 13 seconds ago');
  assert.equal(quoteForYes({...q,created_ts:'invalid'},'COMBO',1000,2),null);
  assert.equal(quoteForYes({...q,no_bid_dollars:'0.0001'},'COMBO',1000,2),null);
  const small={...q,no_contracts_fp:'3.00'};
  assert.ok(quoteForYes(small,'COMBO',1000,2,9900)?.profitCents>0);
  const observed={...q,no_bid_dollars:'0.0490',no_contracts_fp:'5.75',created_ts:new Date(Date.now()-13000).toISOString()};
  assert.equal(quoteForYes(observed,'COMBO',566,2)?.debitCents,551);
});
test('RFQ target reserves room for the fee within the full combo allocation',()=>{
  const budget=2970;
  assert.equal(comboRfqTargetCents(budget),2880);
  const quote={market_ticker:'COMBO',status:'open',no_bid_dollars:'0.0700',no_contracts_fp:'31.77',created_ts:new Date().toISOString()};
  assert.equal(quoteForYes(quote,'COMBO',budget,2),null,'the observed full quote exceeds the fee-inclusive cap');
  assert.equal(quoteForYes(quote,'COMBO',comboAllowedCents(.20,14850),2),null,'the quote cannot exceed the strict allocation');
  assert.equal(comboAllowedCents(.20,14850),2970);
  assert.equal(quoteForYes(quote,'COMBO',2970+10,2),null,'ten cents is less than the quoted fee difference');
  assert.ok(quoteForYes({...quote,no_contracts_fp:'28.74'},'COMBO',budget,2));
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
test('largest available tickets are sampled first without repeating a leg set',()=>{
  const candidates=Array.from({length:6},(_,i)=>candidate('p'+i,'E'+i));
  const collection={collection_ticker:'SIX',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
  const groups=prioritizedComboGroups(compatibleComboGroups([collection],candidates,64));
  assert.deepEqual(groups.map(g=>g.legs.length),[6,5,5,4,4,3,3,2,2]);
  assert.equal(new Set(groups.map(g=>g.legs.map(l=>l.market.ticker).join(','))).size,groups.length);
});
test('thirteen held trades all enter collection lookup and ticket rotation',()=>{
  const candidates=Array.from({length:13},(_,i)=>candidate('p'+i,'E'+i));
  const collection={collection_ticker:'SIX',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
  const all=compatibleComboGroups([collection],candidates,2**candidates.length);
  assert.equal(all.filter(g=>g.legs.length===2).length,78);
  const groups=prioritizedComboGroups(all,12,0);
  assert.equal(groups[0].legs.length,6);
  assert.deepEqual([...new Set(groups.map(g=>g.legs.length))],[6,5,4,3,2]);
  const seen=new Set();
  for(let rotation=0;rotation<39;rotation++)for(const g of prioritizedComboGroups(all,12,rotation))if(g.legs.length===2)seen.add(g.legs.map(l=>l.market.ticker).join(','));
  assert.equal(seen.size,78);
});
test('eighteen held singles are all considered without enumerating every ticket',()=>{
  const rows=Array.from({length:18},(_,i)=>({market_ticker:'p'+i,updated_at:new Date(1800000000000+i).toISOString()}));
  assert.equal(filledComboWindow(rows,new Set(rows.map(r=>r.market_ticker)),null).length,18);
  const candidates=Array.from({length:18},(_,i)=>candidate('p'+i,'E'+i));
  const collection={collection_ticker:'SIX',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:6,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
  const seenPairs=new Set();
  for(let rotation=0;rotation<77;rotation++){
    const groups=plannedComboGroups([collection],candidates,COMBO_RFQ_PLANS,rotation);
    assert.equal(groups[0].legs.length,6);
    assert.ok(groups.some(group=>group.legs.length===2));
    for(const group of groups)if(group.legs.length===2)seenPairs.add(group.legs.map(leg=>leg.market.ticker).sort().join('|'));
  }
  assert.equal(seenPairs.size,153);
  assert.ok([...seenPairs].some(pair=>pair.includes('p17-YES')));
});
test('four held legs try every distinct ticket when all eleven fit the RFQ budget',()=>{
  const candidates=Array.from({length:4},(_,i)=>candidate('p'+i,'E'+i));
  const collection={collection_ticker:'FOUR',is_all_yes:true,is_single_market_per_event:true,
    size_min:2,size_max:4,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
  const groups=plannedComboGroups([collection],candidates,12,0);
  assert.deepEqual([4,3,2].map(size=>groups.filter(g=>g.legs.length===size).length),[1,4,6]);
  assert.equal(new Set(groups.map(g=>g.legs.map(l=>l.market.ticker).sort().join('|'))).size,11);
});
test('very large collection sizes rotate smaller ticket sizes while preserving pairs',()=>{
  const candidates=Array.from({length:18},(_,i)=>candidate('p'+i,'E'+i));
  const collection={collection_ticker:'ANY',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:0,associated_event_tickers:candidates.map(c=>c.event.event_ticker)};
  const sizes=new Set();
  for(let rotation=0;rotation<4;rotation++){
    const groups=plannedComboGroups([collection],candidates,COMBO_RFQ_PLANS,rotation);
    assert.equal(groups[0].legs.length,18);
    assert.ok(groups.some(group=>group.legs.length===2));
    groups.forEach(group=>sizes.add(group.legs.length));
  }
  assert.equal(sizes.size,17);
});
test('one-market-per-event collections still sample all event pairs when held props share an event',()=>{
  const candidates=[candidate('a','E1'),candidate('b','E1'),candidate('c','E2'),candidate('d','E2'),candidate('e','E3')];
  const collection={collection_ticker:'THREE',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:3,associated_event_tickers:['E1','E2','E3']};
  const pairs=new Set();
  for(let rotation=0;rotation<4;rotation++)for(const group of plannedComboGroups([collection],candidates,12,rotation)){
    assert.equal(new Set(group.legs.map(leg=>leg.event.event_ticker)).size,group.legs.length);
    if(group.legs.length===2)pairs.add(group.legs.map(leg=>leg.event.event_ticker).sort().join('|'));
  }
  assert.deepEqual([...pairs].sort(),['E1|E2','E1|E3','E2|E3']);
});
test('collection lookup includes the thirteenth distinct event',async()=>{
  const seen=[];
  await collectionsForEvents(Array.from({length:13},(_,i)=>'E'+i),async path=>{
    seen.push(new URL(path,'https://example.test').searchParams.get('associated_event_ticker'));
    return {multivariate_contracts:[],cursor:''};
  });
  assert.equal(seen.length,13);
  assert.ok(seen.includes('E12'));
});
test('collection lookup does not omit an eighteenth distinct held event',async()=>{
  const seen=[];
  await collectionsForEvents(Array.from({length:18},(_,i)=>'E'+i),async path=>{
    seen.push(new URL(path,'https://example.test').searchParams.get('associated_event_ticker'));
    return {multivariate_contracts:[],cursor:''};
  });
  assert.equal(seen.length,18);
  assert.ok(seen.includes('E17'));
});
test('a newly created combo market 404 is retried while unrelated API errors still surface',async()=>{
  const ticker='COMBO';
  assert.equal(await liveComboMarket(async()=>{throw Error('Kalshi 404 GET /markets/COMBO: not found')},ticker),null);
  assert.equal((await liveComboMarket(async()=>({market:{ticker,status:'active'}}),ticker))?.ticker,ticker);
  await assert.rejects(liveComboMarket(async()=>{throw Error('Kalshi 403 GET /markets/COMBO: denied')},ticker),/403/);
});


test('collection lookup follows every page rather than silently stopping at five',async()=>{
 const collections=await collectionsForEvents(['E'],async path=>{
  const page=Number(new URL(path,'https://k.test').searchParams.get('cursor')||0);
  return {multivariate_contracts:[{collection_ticker:'C'+page}],cursor:page<6?String(page+1):''};
 });assert.equal(collections.length,7);
 await assert.rejects(collectionsForEvents(['E'],async()=>({multivariate_contracts:[],cursor:'stuck'})),/did not advance/);
});
