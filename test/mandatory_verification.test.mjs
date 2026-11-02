import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {rememberIndependentEntry,independentEntryValid,assertExternalPurchase} from '../src/entry_verification.mjs';
import {timedOverEntryValid,overContractKey} from '../src/over_verification.mjs';
import {gameState} from '../src/strategy.mjs';
import {verifyIndependentOverDecision} from '../src/score_verification.mjs';
const now=Date.now(),game={id:'g',verificationId:'external'},market={ticker:'OVER',event_ticker:'TOTAL',rules_primary:'Exact rules'};
test('an internal passed record or a large cushion never substitutes for independent proof',()=>{
  assert.equal(independentEntryValid(game,market,now),false);
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:'OVER',side:'bid'},[{game,market}],now),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
  assert.throws(()=>assertExternalPurchase('/communications/rfqs/R/quotes/Q/accept','PUT',{accepted_side:'no'},undefined,now));
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',{ticker:'OVER',side:'ask',reduce_only:true},undefined,now));
});
test('the dispatch gate requires fresh proof of the same contract and audit record within thirty seconds',()=>{
  const g={...game};rememberIndependentEntry(g,market,'external',now);
  const entries=[{game:g,market}],body={ticker:'OVER',side:'bid'};
  assert.doesNotThrow(()=>assertExternalPurchase('/portfolio/events/orders','POST',body,entries,now+30000));
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',body,entries,now+30001));
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',{...body,ticker:'OTHER'},entries,now));
  assert.throws(()=>assertExternalPurchase('/portfolio/events/orders','POST',body,[{game:g,market:{...market,rules_secondary:'Changed'}}],now));
  assert.equal(independentEntryValid({...g,verificationId:'internal'},market,now),false);
});
test('Rafaela over 0.5 cannot qualify from Kalshi 1-1 when independent evidence reports 0-0',async()=>{
  const milestone={id:'720d2256-dfde-59c1-9bf8-0cc695d4ab33',type:'soccer_match',title:'Rafaela vs Parana',start_date:'2026-11-02T18:00:00Z'};
  const m={ticker:'KXARGNACBTOTAL-26NOV02ARCAP-1',event_ticker:'KXARGNACBTOTAL-26NOV02ARCAP',status:'active',
    title:'Over 0.5 goals scored',floor_strike:.5,yes_ask_dollars:'.87',rules_primary:'Combined total goals scored in the full game after 90 minutes plus stoppage time'};
  const g=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:1,away_score:1,time:"47'",half:'2nd'}});
  g.verificationId='internal';g.overVerification={route:'seller_cushion',contractKey:overContractKey(g,m),sellerAt:now};
  assert.equal(timedOverEntryValid(g,m,now),false);
  const event={id:'401844258',date:milestone.start_date,status:{period:2,displayClock:"73'",type:{state:'in'}},competitions:[{competitors:[
    {homeAway:'home',score:'0',team:{displayName:'Atletico Rafaela'}},{homeAway:'away',score:'0',team:{displayName:'Patronato'}}]}]};
  const decision=await verifyIndependentOverDecision({...g,homeName:'Atletico Rafaela',awayName:'Patronato'},milestone,{market:m,
    fetcher:async()=>({ok:true,json:async()=>({events:[event]})})});
  assert.equal(decision,false);
});
test('the actual API transport rejects unverified initial purchases and quote acceptances before HTTP dispatch',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8'),sent=[];
  const context=vm.createContext({assertExternalPurchase,AbortSignal,API:'https://test.invalid',
    kalshiRateLimit:async()=>{},fetch:async(url,options)=>{sent.push([url,options]);return {ok:true,status:200,json:async()=>({})}}});
  vm.runInContext(source.slice(source.indexOf('async function kalshi('),source.indexOf('// The balance endpoint')),context);
  await assert.rejects(context.kalshi('/portfolio/events/orders',{method:'POST',body:{ticker:'OVER',side:'bid'}}),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
  await assert.rejects(context.kalshi('/communications/rfqs/R/quotes/Q/confirm',{method:'PUT',body:{}}));
  assert.equal(sent.length,0);
  const g={...game};rememberIndependentEntry(g,market,'external',Date.now());
  await context.kalshi('/portfolio/events/orders',{method:'POST',body:{ticker:'OVER',side:'bid'},entryVerifications:[{game:g,market}]});
  assert.equal(sent.length,1,'a genuinely verified purchase can reach the transport');
});
