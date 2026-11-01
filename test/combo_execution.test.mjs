import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mapBatches} from '../src/discovery.mjs';
import {nextComboBatch,comboPairDiagnostics,comboExclusionKey,comboLegAllocation,comboAllowedCents,comboMinimumCents,comboMeetsMinimum,comboRfqTargetCents,selectedComboMarkets,quoteForYes} from '../src/combos.mjs';
import {marketShard,shardCash,comboShardBudget} from '../src/funding.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const execute=source.slice(source.indexOf('async function executeCombo('),source.indexOf('async function checkCurrentHeldCombinations('));
const legs=['A','B','C','D'].map(t=>({event:{event_ticker:t},market:{ticker:t,event_ticker:t,status:'active'},milestone:{id:t},signal:{strategy:'over'},state:{title:t,sport:'NFL',type:'football_game'}}));
const c={collection_ticker:'C',is_all_yes:true,is_single_market_per_event:true,size_min:2,size_max:4,associated_event_tickers:['A','B','C','D']};
function harness({interruptAfterMarket=Infinity}={}){
 const jobs=new Map(),created=[],rfqs=[],cancelled=[];let time=1000,superseded=false;
 class Clock extends Date{static now(){return time}}
 const planner={
  async claim(){
   for(const p of nextComboBatch([c],legs).plans)if(!jobs.has(p.groupKey))jobs.set(p.groupKey,{...p,job:{phase:'planned',rfq_attempts:0},lease:p.groupKey});
   return {groups:[...jobs.values()].filter(p=>['planned','market_ready'].includes(p.job.phase)),coverage:[{size:2,total:'6'}],scope:'scope',exhausted:true};
  },
  async transition(p,from,phase,v={}){
   assert.ok((Array.isArray(from)?from:[from]).includes(p.job.phase));p.job.phase=phase;
   if(phase==='creating_rfq'){p.job.rfq_attempts++;assert.equal(p.job.rfq_attempts,1)}
   if(v.ticker)p.job.combo_ticker=v.ticker;if(v.eventTicker)p.job.combo_event_ticker=v.eventTicker;if(v.market)p.job.combo_market=v.market;return true;
  },
  async release(p){if(['creating_market','creating_rfq','rfq_open'].includes(p.job.phase))p.job.phase='complete'}
 };
 const context=vm.createContext({console:{info(){},warn(){},error(){}},Date:Clock,Number,Math,JSON,Map,Set,Promise,URLSearchParams,
  COMBO_ATTEMPT_MS:45000,COMBO_RFQ_PLANS:12,comboPlanner:planner,comboExclusionKey,comboPairDiagnostics,comboLegAllocation,comboAllowedCents,comboMinimumCents,comboMeetsMinimum,comboRfqTargetCents,selectedComboMarkets,quoteForYes,
  marketShard,shardCash,comboShardBudget,mapBatches,ensureComboAudit:async()=>{},collectionsForEvents:async()=>[c],
  recordComboRejection:async()=>{},exchangeComboExclusion:()=>null,feeReserve:()=>2,profitableCount:()=>1,
  pool:{query:async()=>({rows:[],rowCount:0})},setTimeout:callback=>{time+=45000;callback()},
  kalshi:async(path,options={})=>{
   if(path.startsWith('/multivariate_event_collections/')){
    const picked=options.body.selected_markets.map(m=>m.market_ticker).sort().join('+');created.push(picked);
    if(created.length===interruptAfterMarket)superseded=true;
    return {market_ticker:picked,event_ticker:'COMBO',market:{ticker:picked,event_ticker:'COMBO',status:'active'}};
   }
   if(path==='/communications/rfqs'){rfqs.push(options.body.market_ticker);return {id:options.body.market_ticker}}
   if(path==='/communications/id')return {communications_id:'owner'};
   if(path.startsWith('/communications/quotes?'))return {quotes:[]};
   if(options.method==='DELETE'){cancelled.push(path);return {}}
   throw Error('Unexpected external call: '+path);
  }});
 vm.runInContext(execute,context);
 const account={balance:10000,portfolio_value:0,balance_breakdown:[{exchange_index:0,balance:'100.00'}]};
 return {created,rfqs,cancelled,jobs,run:()=>context.executeCombo(legs,account,10000,.2,null,()=>superseded),resume:()=>{superseded=false}};
}
test('execution requests all eleven unordered tickets once, then issues no duplicate market or RFQ requests',async()=>{
 const h=harness();await h.run();
 assert.equal(h.rfqs.length,11);assert.equal(new Set(h.rfqs).size,11);
 assert.deepEqual([2,3,4].map(n=>h.rfqs.filter(s=>s.split('+').length===n).length),[6,4,1]);
 assert.equal(h.cancelled.length,11);
 await h.run();assert.equal(h.rfqs.length,11);assert.equal(h.created.length,11);
});
test('supersession preserves unrequested work and prepared markets resume without being recreated',async()=>{
 const h=harness({interruptAfterMarket:3});await h.run();
 const createdBefore=[...h.created],rfqsBefore=[...h.rfqs];assert.ok(createdBefore.length>rfqsBefore.length);
 h.resume();await h.run();
 assert.equal(new Set(h.created).size,h.created.length,'each exact market is created once');
 assert.equal(new Set(h.rfqs).size,h.rfqs.length,'each unordered set receives at most one RFQ');
 assert.equal(h.rfqs.length,11);
});
