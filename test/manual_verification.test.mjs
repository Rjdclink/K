import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal} from '../src/strategy.mjs';
import {rememberIndependentEntry,independentEntryValid,assertExternalPurchase} from '../src/entry_verification.mjs';
import {verifyIndependentOverDecision} from '../src/score_verification.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const segment=source.slice(source.indexOf('async function verifiedPurchaseEntries('),source.indexOf('async function currentManualBuy('));
const start='2026-11-02T18:00:00Z';
const milestone={id:'fixture',type:'soccer_match',title:'Atletico Rafaela vs Patronato',start_date:start};
const market={ticker:'KXARGNACBTOTAL-TEST-1',event_ticker:'KXARGNACBTOTAL-TEST',status:'active',floor_strike:.5,
 title:'Over 0.5 goals scored',rules_primary:'Combined total goals scored in the full game after 90 minutes plus stoppage time'};
const other={...market,ticker:'KXARGNACBTOTAL-TEST-2',floor_strike:1.5,title:'Over 1.5 goals scored'};
const legs=[market,other].map(m=>({market_ticker:m.ticker,event_ticker:m.event_ticker}));
const combo={ticker:'COMBO',status:'active',mve_collection_ticker:'C',mve_selected_legs:legs.map(l=>({...l,side:'yes'}))};
function harness({goals=4,unavailable=false,stale=false}={}){
 const records=[],markets=new Map([market,other,combo].map(m=>[m.ticker,m]));
 let ids=0;
 const bindings={console,gameState,overSignal,rememberIndependentEntry,independentEntryValid,randomUUID:()=>String(++ids),auditTable:async()=>{},
  pool:{query:async(sql,args)=>{
   if(sql.startsWith('SELECT game_id'))return {rows:[{game_id:'fixture',strategy:'over',combo_legs:args[0]==='COMBO'?legs:null}]};
   if(sql.startsWith('SELECT milestone'))return {rows:[{milestone}]};
   if(sql.startsWith('INSERT INTO verification_records')){records.push(args);return {rows:[]}};
   throw Error(sql);
  }},kalshi:async path=>({market:markets.get(decodeURIComponent(path.split('/').at(-1)))}),
  liveMilestone:async()=>({milestone_id:'fixture',details:{status:'live',home_score:2,away_score:2,time:"68'",half:'2nd'}}),
  auditedOver:async(g,m,{market:contract})=>{
   const values=[];
   const event={id:'401844258',date:start,status:{period:2,displayClock:"68'",type:{state:'in'}},competitions:[{competitors:[
    {homeAway:'home',score:String(goals),team:{displayName:'Atletico Rafaela'}},{homeAway:'away',score:'0',team:{displayName:'Patronato'}}],
    details:Array.from({length:goals},()=>({scoringPlay:true,scoreValue:1}))}]};
   const passed=await verifyIndependentOverDecision(g,m,{market:contract,onOverValue:value=>values.push(value),
    fetcher:async()=>({ok:true,json:async()=>({events:unavailable?[]:[event]})})});
   if(passed===true){g.verificationId=String(++ids);rememberIndependentEntry(g,contract,g.verificationId,Date.now()-(stale?30001:0),Math.min(...values))}
   return passed;
  }};
 const ctx=vm.createContext(bindings);vm.runInContext(segment,ctx);return {ctx,records};
}
test('manual additions cannot inherit a filled contract’s false Kalshi cushion or bypass missing external coverage',async()=>{
 for(const options of [{goals:0},{unavailable:true},{stale:true}]){
  const {ctx}=harness(options);
  await assert.rejects(ctx.verifiedPurchaseEntries(market),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
 }
 const {ctx}=harness();const entries=await ctx.verifiedPurchaseEntries(market);
 assert.equal(entries[0].game.independentEntry.overValue,4);
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:market.ticker,side:'bid'},entries));
});
test('a combo purchase requires fresh proof for every exact YES leg and binds the entire selected contract',async()=>{
 const {ctx,records}=harness();const entries=await ctx.verifiedPurchaseEntries(combo);
 assert.equal(records.length,1);assert.equal(JSON.parse(records[0][2]).components.length,2);
 assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:'COMBO',side:'bid'},entries));
 const changed={...combo,mve_selected_legs:[combo.mve_selected_legs[0],{...combo.mve_selected_legs[1],side:'no'}]};
 assert.equal(independentEntryValid(entries[0].game,changed),false);
 for(const altered of [changed,{...combo,mve_selected_legs:[combo.mve_selected_legs[0],combo.mve_selected_legs[0]]},
  {...combo,mve_selected_legs:[combo.mve_selected_legs[0]]}])
  await assert.rejects(ctx.verifiedPurchaseEntries(altered),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
 await assert.rejects(harness({goals:1}).ctx.verifiedPurchaseEntries(combo),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
});
