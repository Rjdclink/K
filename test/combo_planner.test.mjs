import test from 'node:test';
import assert from 'node:assert/strict';
import {createComboPlanner} from '../src/combo_planner.mjs';
import {comboExclusionKey} from '../src/combos.mjs';
const leg=ticker=>({market:{ticker,event_ticker:ticker,status:'active'},event:{event_ticker:ticker}});
const legs=['A','B','C','D'].map(leg);
const collection={collection_ticker:'C',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:4,associated_event_tickers:['A','B','C','D','E']};
function memoryPool(){
 let time=1000,id=0,locked=false;const waiters=[],jobs=new Map(),cursors=new Map(),legacy=[],orders=[],queries=[];
 const clock=()=>time;
 async function query(sql,args=[]){
  sql=sql.trimStart();queries.push(sql);
  if(sql.startsWith('CREATE')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes("outcome='interrupted_external_request'")){
   for(const j of jobs.values())if(['creating_market','creating_rfq','rfq_open'].includes(j.phase)&&j.lease_until<clock())Object.assign(j,{phase:'complete',outcome:'interrupted_external_request',lease_id:null,lease_until:null});return {rows:[]};
  }
  if(sql.includes('FROM trade_attempts a')&&sql.startsWith('UPDATE'))return {rows:[]};
  if(sql.startsWith('SELECT progress'))return {rows:cursors.has(args[0])?[{progress:structuredClone(cursors.get(args[0]))}]:[]};
  if(sql.startsWith('SELECT DISTINCT leg_tickers'))return {rows:legacy};
  if(sql.startsWith('SELECT market_ticker,status,combo_legs'))return {rows:orders};
  if(sql.startsWith('SELECT group_key'))return {rows:[...jobs.values()].filter(j=>j.leg_tickers.every(t=>args[0].includes(t))).map(j=>({group_key:j.group_key}))};
  if(sql.startsWith('SELECT * FROM combo_plan_jobs'))return {rows:[...jobs.values()].sort((a,b)=>a.queue_order-b.queue_order).filter(j=>['planned','market_ready'].includes(j.phase)&&(!j.lease_until||j.lease_until<clock())&&j.leg_tickers.every(t=>args[0].includes(t))&&(!args[1]||j.leg_tickers.includes(args[1]))).map(j=>structuredClone(j))};
  if(sql.startsWith('INSERT INTO combo_plan_jobs')){
   if(jobs.has(args[0]))return {rows:[]};
   const j={group_key:args[0],leg_tickers:args[1],collection_ticker:args[2],phase:args[3]||'planned',combo_ticker:args[4]||null,
    lease_id:null,lease_until:null,rfq_attempts:0,queue_order:id++,created_at:id,outcome:args[3]?'legacy_attempt_imported':null};jobs.set(j.group_key,j);return {rows:[structuredClone(j)]};
  }
  if(sql.startsWith('INSERT INTO combo_plan_cursors')){cursors.set(args[0],JSON.parse(args[1]));return {rows:[]}}
  if(sql.startsWith('UPDATE combo_plan_jobs SET lease_id')){
   const j=jobs.get(args[0]);if(!j||!['planned','market_ready'].includes(j.phase)||j.lease_until>=clock())return {rows:[]};
   Object.assign(j,{lease_id:args[1],lease_until:clock()+180000});return {rows:[structuredClone(j)]};
  }
  if(sql.startsWith('UPDATE combo_plan_jobs SET phase=$4')){
   const j=jobs.get(args[0]);if(!j||j.lease_id!==args[1]||!args[2].includes(j.phase)||j.lease_until<=clock()||args[3]==='creating_rfq'&&j.rfq_attempts!==0)return {rows:[]};
   j.phase=args[3];if(args[4])j.combo_ticker=args[4];if(args[5])j.combo_event_ticker=args[5];if(args[6])j.combo_market=JSON.parse(args[6]);if(args[7])j.rfq_id=args[7];if(args[8])j.outcome=args[8];if(j.phase==='creating_rfq')j.rfq_attempts++;
   return {rows:[structuredClone(j)]};
  }
  if(sql.startsWith('UPDATE combo_plan_jobs SET phase=CASE')){
   const j=jobs.get(args[0]);if(j?.lease_id===args[1]){
    if(j.phase==='rfq_open')j.outcome=args[2];if(['planned','market_ready'].includes(j.phase))j.queue_order=id++;if(['creating_market','creating_rfq','rfq_open'].includes(j.phase))j.phase='complete';j.lease_id=null;j.lease_until=null;
   }return {rows:[]};
  }
  if(sql.includes("outcome='contract_or_eligibility_changed'")){const j=jobs.get(args[0]);j.phase='complete';return {rows:[]}}
  throw Error('Unhandled SQL: '+sql);
 }
 const pool={query,connect:async()=>({
  async query(sql,args){
   if(sql.includes('pg_advisory_xact_lock')){if(locked)await new Promise(r=>waiters.push(r));locked=true;return {rows:[]}}
   if(sql==='COMMIT'||sql==='ROLLBACK'){locked=false;waiters.shift()?.();return {rows:[]}}
   return query(sql,args);
  },release(){}})};
 return {pool,jobs,cursors,legacy,orders,queries,advance:ms=>{time+=ms}};
}
const create=(db)=>createComboPlanner(db.pool,{uuid:()=>crypto.randomUUID()});
async function issueOnce(planner,group){
 assert.equal(await planner.transition(group,'planned','creating_market'),true);
 assert.equal(await planner.transition(group,'creating_market','market_ready',{ticker:'COMBO-'+group.groupKey,eventTicker:'EV',market:{ticker:'COMBO-'+group.groupKey,status:'active'}}),true);
 assert.equal(await planner.transition(group,'market_ready','creating_rfq'),true);
 assert.equal(await planner.transition(group,'creating_rfq','rfq_open',{rfq:'RFQ-'+group.groupKey}),true);
 await planner.release(group);
}
test('saved cursor plus durable jobs attempt all eleven sets once across restarts and reversed input',async()=>{
 const db=memoryPool(),seen=new Set();
 for(let pass=0;pass<10;pass++){
  const planner=create(db),r=await planner.claim([collection],pass%2?[...legs].reverse():legs,{limit:2});
  for(const group of r.groups){assert.equal(seen.has(group.groupKey),false);seen.add(group.groupKey);await issueOnce(planner,group)}
 }
 assert.equal(seen.size,11);assert.equal([...db.jobs.values()].filter(j=>j.rfq_attempts===1).length,11);
 assert.equal((await create(db).claim([collection],legs)).groups.length,0);
});
test('unattempted work resumes after preemption without skipping saved queue entries',async()=>{
 const db=memoryPool(),p=create(db),first=await p.claim([collection],legs,{limit:2});
 for(const group of first.groups)await p.release(group,{superseded:true});
 const second=await create(db).claim([collection],legs,{limit:2});
 assert.deepEqual(second.groups.map(g=>g.groupKey),first.groups.map(g=>g.groupKey));
 assert.ok(second.groups.every(g=>g.job.rfq_attempts===0));
});
test('a prepared market resumes directly and no unordered set can issue a second RFQ',async()=>{
 const db=memoryPool(),p=create(db),{groups:[group]}=await p.claim([collection],legs,{limit:1});
 await p.transition(group,'planned','creating_market');await p.transition(group,'creating_market','market_ready',{ticker:'SAVED',eventTicker:'EV',market:{ticker:'SAVED'}});await p.release(group,{superseded:true});
 const resumed=create(db),{groups:[again]}=await resumed.claim([collection],legs,{limit:1});
 assert.equal(again.groupKey,group.groupKey);assert.equal(again.job.phase,'market_ready');assert.equal(again.job.combo_ticker,'SAVED');
 assert.equal(await resumed.transition(again,'market_ready','creating_rfq'),true);
 assert.equal(await resumed.transition(again,'creating_rfq','creating_rfq'),false);
 await resumed.release(again);assert.equal(db.jobs.get(group.groupKey).rfq_attempts,1);
});
test('parallel workers lease disjoint groups and expired unattempted leases are recoverable',async()=>{
 const db=memoryPool();const [a,b]=await Promise.all([create(db).claim([collection],legs,{limit:2}),create(db).claim([collection],legs,{limit:2})]);
 assert.equal(new Set([...a.groups,...b.groups].map(g=>g.groupKey)).size,4);
 db.advance(180001);const recovered=await create(db).claim([collection],legs,{limit:2});
 assert.deepEqual(recovered.groups.map(g=>g.groupKey),a.groups.map(g=>g.groupKey));
});
test('an interrupted external request never causes an automatic duplicate POST',async()=>{
 const db=memoryPool(),p=create(db),{groups:[group]}=await p.claim([collection],legs,{limit:1});
 await p.transition(group,'planned','creating_market');db.advance(180001);
 const next=await create(db).claim([collection],legs,{limit:12});
 assert.ok(next.groups.every(g=>g.groupKey!==group.groupKey));assert.equal(db.jobs.get(group.groupKey).phase,'complete');
});
test('new-fill and general lanes share unordered identities and import genuine legacy attempts',async()=>{
 const db=memoryPool();db.legacy.push({leg_tickers:['A','B']});
 const p=create(db),anchored=await p.claim([collection],legs,{requiredTicker:'D',limit:12});
 assert.ok(anchored.groups.every(g=>g.legs.some(l=>l.market.ticker==='D')));
 for(const g of anchored.groups)await issueOnce(p,g);
 const normal=await create(db).claim([collection],legs,{limit:12});
 assert.equal(normal.groups.length,3);assert.ok(normal.groups.every(g=>!g.legs.some(l=>l.market.ticker==='D')));
 assert.ok(normal.groups.every(g=>g.groupKey!==comboExclusionKey(legs.slice(0,2))));
 assert.equal(db.jobs.get(comboExclusionKey(legs.slice(0,2))).outcome,'legacy_attempt_imported');
});
test('adding holdings cannot cause previously attempted exact groups to be requested again',async()=>{
 const db=memoryPool(),p=create(db),two=legs.slice(0,2),first=await p.claim([collection],two,{limit:12});
 await issueOnce(p,first.groups[0]);
 const changed=await create(db).claim([collection],legs,{limit:12});
 assert.equal(changed.groups.length,10);assert.ok(changed.groups.every(g=>g.groupKey!==first.groups[0].groupKey));
});

test('cash-blocked prepared groups cannot pin the queue ahead of all other combinations',async()=>{
 const db=memoryPool(),seen=new Set();
 for(let pass=0;pass<25;pass++){
  const p=create(db),r=await p.claim([collection],legs,{limit:2});
  for(const g of r.groups){seen.add(g.groupKey);await p.release(g)}
 }
 assert.equal(seen.size,11,'all distinct groups get considered despite every earlier group deferring before an RFQ');
 assert.ok([...db.jobs.values()].every(j=>j.rfq_attempts===0));
});
