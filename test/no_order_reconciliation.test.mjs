import test from 'node:test';
import assert from 'node:assert/strict';
import {localNoPurchaseFailure,reconcileUnresolvedNoOrders} from '../src/no_order_reconciliation.mjs';

const now=Date.parse('2026-11-24T00:00:00Z');
const row=(id,ageMs,extra={})=>({id,market_ticker:'KXTOTAL-'+id,
 status:'check_order',order_id:null,fill_count:0,error:'Network timeout',
 created_at:new Date(now-ageMs).toISOString(),...extra});

function harness(rows,lookup){
 const changes=[];
 const query=async(sql,args=[])=>{
  if(sql.includes('SELECT id,market_ticker'))return {rows};
  changes.push({sql,args});return {rowCount:1};
 };
 return {changes,run:()=>reconcileUnresolvedNoOrders(query,lookup,order=>{
  if(!order||!['executed','cancelled','canceled'].includes(order.status))return null;
  const filled=Number(order.fill_count_fp);
  return Number.isFinite(filled)?{filled}:null;
 },{now})};
}

test('locally rejected NO order is retired without querying the exchange',async()=>{
 const h=harness([row('local',30_000,{error:'New soccer/hockey position blocked: combined game score must remain below five goals'})],
  ()=>{throw Error('A local rejection must never reach Kalshi')});
 assert.equal(await h.run(),1);
 assert.match(h.changes[0].sql,/status='unfilled'/);
 assert.deepEqual(h.changes[0].args,['local','check_order']);
 for(const code of ['LOCAL_EXTERNAL_VERIFICATION_REQUIRED','LOCAL_FINAL_FIVE_WINDOW_REQUIRED',
  'LOCAL_GOAL_SCORE_LIMIT','LOCAL_ENTRY_EXCLUDED'])assert.equal(localNoPurchaseFailure({code}),true);
 assert.equal(localNoPurchaseFailure({message:'Network timeout'}),false);
});

test('an executed uncertain NO attempt is reconciled as filled',async()=>{
 const h=harness([row('filled',180_000)],async()=>({status:'executed',fill_count_fp:'2',order_id:'k-order'}));
 assert.equal(await h.run(),1);
 assert.deepEqual(h.changes[0].args,['filled','filled','k-order',2,'check_order']);
});

test('an exchange-absent old NO attempt clears while recent and open attempts remain blocked',async()=>{
 const h=harness([row('old',360_000),row('recent',90_000),row('open',180_000)],
  async ticker=>ticker==='KXTOTAL-open'?{status:'resting',fill_count_fp:'0'}:null);
 assert.equal(await h.run(),1);
 assert.deepEqual(h.changes[0].args,['old','check_order']);
 assert.equal(h.changes.length,1);
});

test('exchange lookup failure leaves an uncertain NO attempt blocked',async()=>{
 const errors=[];
 const h=harness([row('error',360_000)],async()=>{throw Error('exchange unavailable')});
 assert.equal(await h.run(),0);
 assert.deepEqual(h.changes,[]);
});
