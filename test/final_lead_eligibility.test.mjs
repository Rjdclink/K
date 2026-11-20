import test from 'node:test';
import assert from 'node:assert/strict';
import {runEligibleFinalLeadChecks,finalLeadKey} from '../src/final_lead_eligibility.mjs';
import {readFileSync} from 'node:fs';
const c=(id,ticker,eligible=true)=>({state:{id,home:2,away:1},market:{ticker},eligible});
test('every eligible commanding lead receives a real final score verification attempt before any liquidity or cash check',async()=>{
 const candidates=[c('a','WIN-A'),c('a','WIN-B'),c('b','WIN-C',false)];
 const checked=[],recorded=[];
 const result=await runEligibleFinalLeadChecks(candidates,{
  eligible:x=>x.eligible,
  verify:async x=>{checked.push(x.market.ticker);return x.market.ticker==='WIN-A';},
  record:async(x,decision)=>recorded.push([x.market.ticker,decision.reason])
 });
 assert.deepEqual(checked,['WIN-A','WIN-B']);
 assert.equal(result.get(finalLeadKey(candidates[0])).ok,true);
 assert.equal(result.get(finalLeadKey(candidates[1])).ok,false);
 assert.equal(result.has(finalLeadKey(candidates[2])),false);
 assert.equal(recorded.length,2);
 assert.match(recorded[0][1],/Final score verification passed/);
 assert.match(recorded[1][1],/Final score verification attempted/);
});
test('an unavailable or throwing source is recorded as attempted, never called verified',async()=>{
 const cs=[c('n','NHL'),c('s','SOCCER')];
 const checked=[];
 const result=await runEligibleFinalLeadChecks(cs,{
  eligible:()=>true,verify:async x=>{checked.push(x.market.ticker);if(x.market.ticker==='SOCCER')throw Error('ESPN timeout');return null;}
 });
 assert.equal(result.size,2);assert.equal(checked.length,2);
 assert.ok([...result.values()].every(x=>x.attempted===true&&x.ok===false));
 assert.match(result.get(finalLeadKey(cs[1])).reason,/ESPN timeout/);
});

test('the actual YES scanner invokes final verification before publishing any Eligible label',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const eligible=src.indexOf('const leadFinalResults=live()?await runEligibleFinalLeadChecks(');
 const snapshot=src.indexOf('for(const [id,candidates] of snapshotCandidates){',eligible);
 assert.ok(eligible>0&&snapshot>eligible,'the actual verification is awaited before dashboard publication');
 assert.match(src.slice(eligible,snapshot),/verify:c=>auditedOver\(/,
   'a genuine independent provider score request must be dispatched');
 assert.match(src.slice(eligible,snapshot),/recordDecision\(\{source:'eligible_lead_final'/,
   'every attempted independent final check has an auditable outcome');
 assert.match(src.slice(snapshot,snapshot+1800),/leadFinalResults\.get\(finalLeadKey\(c\)\)/,
   'the dashboard must report the result rather than a hypothetical Eligible status');
});