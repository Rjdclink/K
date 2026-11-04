import {rememberIndependentEntry} from '../src/entry_verification.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,confirmedOver,playerOverSpec,fallbackScoringUnits} from '../src/strategy.mjs';
import {verifyExternalOverExposure} from '../src/over_exposure.mjs';
import {sameSportsContract,overContractKey,freshOverObservation,freshOverState,overTiming,overCushion,sameOverReading,timedOverEntryValid,OVER_FRESH_MS,OVER_EXTERNAL_DELAY_MS} from '../src/over_verification.mjs';
const start=Date.parse('2026-11-01T12:00:00Z');
const milestone={id:'game',type:'basketball_game',title:'Boston at New York',details:{league:'NBA'}};
const market={ticker:'KXNBATOTAL-TEST-T139',event_ticker:'KXNBATOTAL-TEST',status:'active',floor_strike:139.5,title:'Over 139.5 total points',rules_primary:'Combined total points scored in the full game',strike_type:'greater',yes_ask_dollars:'.95',yes_ask_size_fp:'100'};
test('fast and scan paths reject a changed contract while allowing a new ask',()=>{
 assert.equal(sameSportsContract(market,{...market,yes_ask_dollars:'.96'}),true);
 assert.equal(sameSportsContract(market,{...market,floor_strike:140.5}),false);
 assert.equal(sameSportsContract(market,{...market,event_ticker:'OTHER'}),false);
});
const liveState=(m,raw)=>({...gameState(m,raw),verifiedLive:true});
const state=(at,home=70,away=70)=>liveState(milestone,{milestone_id:'game',_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:home,away_score:away,quarter:3,time_remaining:'5:00',last_updated_ts:at/1000}});
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const runtime=source.slice(source.indexOf('let overWindowsReady;'),source.indexOf('async function auditSingleReadNbaLead('));
function harness({home=70,away=70,seller=true,decisions=[]}={}){
 let time=start,window=null,ids=0,externalCount=0,kalshiCount=0;const events=[],proofs=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
 const context=vm.createContext({Date:Clock,Number,JSON,Math,Promise,console,
  overContractKey,overCushion,playerOverSpec,fallbackScoringUnits,freshOverObservation:g=>freshOverObservation(g,time),freshOverState:(g,m)=>freshOverState(g,m,time),overTiming:(w,g,m,at=time)=>overTiming(w,g,m,at),sameOverReading,timedOverEntryValid:(g,m)=>timedOverEntryValid(g,m,time),OVER_FRESH_MS,
  OVER_EXTERNAL_DELAY_MS,verifyExternalOverExposure,rememberIndependentEntry,gameState:liveState,confirmedOver,overSignal,randomUUID:()=>`id-${++ids}`,auditTable:async()=>{},
  pool:{query:async(sql,args=[])=>{
   if(sql.startsWith('CREATE'))return {rows:[],rowCount:0};
   if(sql.startsWith('INSERT INTO over_verification_windows')){
    if(!window||window.contract_key!==args[2]||window.game_id!==args[1])window={market_ticker:args[0],game_id:args[1],contract_key:args[2],generation:args[3],initial_at:args[4],last_seen:args[4],contract:JSON.parse(args[5]),initial_state:JSON.parse(args[6]),first_external_at:null,first_external_id:null};
    window.last_seen=time;return {rows:[{...window}],rowCount:1};
   }
   if(sql.startsWith('SELECT * FROM over_verification_windows'))return {rows:window?[{...window}]:[]};
   if(sql.startsWith('SELECT 1 FROM over_verification_windows'))return {rows:[],rowCount:window?.generation===args[1]?1:0};
   if(sql.startsWith('UPDATE over_verification_windows SET last_seen')){if(window)window.last_seen=args[2];return {rows:[],rowCount:1}}
   if(sql.startsWith('UPDATE over_verification_windows')){if(!window||window.generation!==args[1])return {rows:[],rowCount:0};window.first_external_at??=args[2];window.first_external_id??=args[3];return {rows:[{...window}],rowCount:1}}
   if(sql.startsWith('DELETE')){if(window&&(!args[1]||window.generation===args[1]||window.game_id===args[1]))window=null;return {rows:[],rowCount:1}}
   if(sql.startsWith('INSERT INTO verification_records')){proofs.push(JSON.parse(args[2]));return {rows:[],rowCount:1}}
   if(sql.includes('SELECT market_ticker,game_id,contract,generation'))return {rows:window?[window]:[]};
   throw Error(sql);
  }},reportVerifiedGate:async(g,t,message,clearAsk,wait)=>events.push(['progress',message,wait]),kalshi:async()=>({market}),recoverSummaryAsk:async m=>m,hasAsk:()=>seller,executableQuote:async m=>seller?m:null,
  auditedOver:async(g,m,opts)=>{assert.equal(opts.cache,undefined);events.push(['external',time]);externalCount++;const decision=decisions.length?decisions.shift():true;if(decision===true){g.verificationId='external-'+externalCount;rememberIndependentEntry(g,opts.market,g.verificationId,time)}return decision},
  liveMilestone:async(id,opts={})=>{kalshiCount++;events.push(['kalshi-dispatch',time]);opts.onDispatch?.();if(opts.onDispatch)assert.equal(events.at(-1)[0],'external');time+=2;return {milestone_id:'game',details:{status:'live',home_score:home,away_score:away,quarter:3,time_remaining:'5:00',last_updated_ts:time/1000}}}
 });vm.runInContext(runtime,context);
 return {events,proofs,context,get window(){return window},get externalCount(){return externalCount},get kalshiCount(){return kalshiCount},run:async(ms)=>{if(ms!==undefined)time=start+ms;return context.confirmedIndependentOver(state(time-1,home,away),milestone,market)},setTime:ms=>{time=start+ms},setScore:(h,a)=>{home=h;away=a},setSeller:v=>{seller=v}};
}
test('uncushioned over waits 20 seconds for external check one and 3:00 for the simultaneous final pair',async()=>{
 const h=harness();assert.equal(await h.run(0),null);assert.equal(h.externalCount,0);assert.equal(h.window.initial_at,start);
 assert.deepEqual(JSON.parse(JSON.stringify(h.events.at(-1))),['progress','Waiting for first external check (20s; minimum 20s)',{dueAt:start+20000,updatedAt:start}]);
 assert.equal(await h.run(19999),null);assert.equal(h.externalCount,0);
 assert.equal(await h.run(20000),null);assert.equal(h.externalCount,1);assert.equal(h.kalshiCount,0);
 for(const ms of [80000,140000,179999])assert.equal(await h.run(ms),null);
 assert.equal(h.externalCount,1);const verified=await h.run(180000);assert.ok(verified);assert.equal(h.externalCount,2);assert.equal(h.kalshiCount,1);
 assert.equal(verified.overVerification.route,'elapsed');assert.equal(verified.overVerification.initialAt,start);assert.equal(verified.overVerification.pairedAt,start+180000);
 assert.deepEqual(h.events.filter(e=>['kalshi-dispatch','external'].includes(e[0])).slice(-2),[['kalshi-dispatch',start+180000],['external',start+180000]]);
 assert.equal(h.proofs.at(-1).mode,'independent_timed_over');assert.equal(timedOverEntryValid(verified,market,start+180003),true);assert.equal(timedOverEntryValid(verified,market,start+190001),false);
});
test('a cheap nearby total starts external verification before crossing and enters only after a fresh final check',async()=>{
 const h=harness({home:69,away:70});const cheap={...market,yes_ask_dollars:'.68'};
 assert.equal(overSignal(state(start,69,70),cheap),null);
 assert.ok(overSignal(state(start,69,70),cheap,{allowUncrossed:true}));
 assert.ok(overSignal(state(start,70,70),cheap));
 await h.context.preflightNearOver(state(start,69,70),milestone,cheap);
 assert.equal(h.window.initial_at,start);assert.equal(h.externalCount,0);
 h.setTime(20000);
 await h.context.preflightNearOver(state(start+20000,69,70),milestone,cheap);
 assert.equal(h.externalCount,0,'a pre-cross score cannot verify an over or reset the seller-backed clock');
 assert.equal(h.window.initial_at,start);
 h.setScore(70,70);
 await h.context.pruneOverWindows([{state:state(start+180000,70,70)}]);
 assert.equal(h.window.initial_at,start);
 const ready=await h.run(180000);
 assert.ok(ready);assert.equal(h.externalCount,2);
 assert.equal(ready.overVerification.firstExternalAt,start+180000);
});
test('a cushioned over needs independent external confirmation before entry',async()=>{
 const h=harness({home:75});const verified=await h.run(0);assert.ok(verified);assert.equal(h.externalCount,1);assert.equal(h.kalshiCount,0);assert.equal(h.window,null);
 assert.equal(verified.overVerification.route,'seller_cushion');assert.equal(verified.overVerification.cushionUnits,4);
 assert.equal(timedOverEntryValid(verified,market,start+3),true);assert.equal(timedOverEntryValid({...verified,home:70},market,start+3),false);
 assert.equal(timedOverEntryValid(verified,market,start+10001),false);
 assert.equal(timedOverEntryValid(verified,{...market,floor_strike:138.5},start+3),false);
});
test('seller is required to start; a scan gap preserves the clock and a changed contract resets it',async()=>{
 const noSeller=harness({home:75,seller:false});assert.equal(await noSeller.run(0),null);assert.equal(noSeller.externalCount,0);
 const h=harness({seller:false});await h.run(0);assert.equal(h.window,null);assert.equal(h.externalCount,0);
 h.setSeller(true);await h.run(10000);assert.equal(h.window.initial_at,start+10000);
 await h.run(100001);assert.equal(h.window.initial_at,start+10000);assert.equal(h.externalCount,1);
 h.window.contract_key='changed';await h.run(100002);assert.equal(h.window.initial_at,start+100002);
});
test('even a large scoring cushion is blocked when independent confirmation is missing or contradictory',async()=>{
 for(const decision of [null,false]){
  const h=harness({home:90,decisions:[decision]});
  assert.equal(await h.run(0),null);assert.equal(h.externalCount,1);
 }
});
test('missing and contradictory external readings block uncushioned entries',async()=>{
 for(const decision of [null,false]){
  const h=harness({decisions:[decision]});await h.run(0);assert.equal(await h.run(20000),null);assert.equal(h.externalCount,1);assert.equal(h.proofs.length,0);if(decision===false)assert.equal(h.window,null);
  const final=harness({decisions:[true,decision]});await final.run(0);await final.run(20000);await final.run(80000);await final.run(140000);assert.equal(await final.run(180000),null);assert.equal(final.externalCount,2);assert.equal(final.proofs.length,0);if(decision===false)assert.equal(final.window,null);
 }
});
test('lost crossing clears the durable clock; increasing scores preserve it',async()=>{
 const h=harness();await h.run(0);await h.run(20000);h.setScore(72,70);await h.run(80000);assert.equal(h.window.initial_at,start);
 await h.context.pruneOverWindows([{state:state(start,69,70)}]);assert.equal(h.window.initial_at,start);
 await h.context.pruneOverWindows([{state:state(start+80000,69,70)}]);assert.equal(h.window,null);
});
test('player, team and period cushions use the exact selected statistic',()=>{
 const g={...state(start,75,70),homeTeamId:'ny',awayTeamId:'bos',homeName:'New York',awayName:'Boston'};
 const prop={...market,event_ticker:'KXNBAREB-TEST',title:'Pat Player: 6+ rebounds',yes_sub_title:'Pat Player: 6+',floor_strike:5.5,custom_strike:{basketball_player:'p'}};
 assert.equal(overCushion({...g,playerStats:{p:{rebounds:6}}},prop),null);assert.equal(overCushion({...g,playerStats:{p:{rebounds:7}}},prop),1);
 const points={...market,event_ticker:'KXNBAPTS-TEST',title:'Pat Player: 20+ points',yes_sub_title:'Pat Player: 20+',floor_strike:19.5,custom_strike:{basketball_player:'p'}};
 assert.equal(overTiming({initial_at:start,first_external_at:null},{...g,playerStats:{p:{points:20}}},points,start).stage,'invalid');
 assert.deepEqual(overTiming({initial_at:start,first_external_at:start+20000,first_external_id:'first'},{...g,playerStats:{p:{rebounds:7}}},prop,start+109999),{stage:'final_wait',remainingMs:1,minimumMs:110000});
 assert.equal(overTiming({initial_at:start,first_external_at:start+20000,first_external_id:'first'},{...g,playerStats:{p:{rebounds:7}}},prop,start+110000).route,'cushion');
 const team={...market,event_ticker:'KXNBATEAMTOTAL-TEST',title:'New York over 73.5 total points',floor_strike:73.5,custom_strike:{basketball_team:'ny'}};
 assert.equal(overCushion(g,team),null);
 const segment={...market,event_ticker:'KXNBA1QTOTAL-TEST',title:'Over 39.5 total points in 1st quarter',floor_strike:39.5};
 const periods={...g,periodScores:[{number:1,home:21,away:19}]};assert.equal(overCushion(periods,segment),null);assert.equal(sameOverReading(periods,{...periods,periodScores:[{number:1,home:22,away:19}]},segment),false);
});
test('one credited steal cannot authorize YES after any wait; two steals need both checks and 1:50',()=>{
 const prop={...market,event_ticker:'KXNBASTL-TEST',title:'Dillon Brooks: 1+ steals',yes_sub_title:'Dillon Brooks: 1+',floor_strike:.5,custom_strike:{basketball_player:'p'}};
 const one={...state(start+180000),playerStats:{p:{steals:1}}},two={...one,playerStats:{p:{steals:2}}};
 const window={initial_at:start,first_external_at:start+20000,first_external_id:'first'};
 assert.equal(overTiming(window,one,prop,start+180000).stage,'invalid');
 assert.equal(overTiming(window,two,prop,start+109999).stage,'final_wait');
 assert.equal(overTiming(window,two,prop,start+110000).route,'cushion');
 const proof={contractKey:overContractKey(one,prop),initialAt:start,firstExternalAt:start+20000,firstExternalId:'first',pairedAt:start+180000,pairedExternalId:'second',route:'elapsed'};
 const verified={...one,verificationId:'aggregate',overVerification:proof};rememberIndependentEntry(verified,prop,'aggregate',start+180000);
 assert.equal(timedOverEntryValid(verified,prop,start+180001),false);
 const cushioned={...state(start+110000),playerStats:{p:{steals:2}},verificationId:'aggregate',overVerification:{...proof,route:'cushion',pairedAt:start+110000}};rememberIndependentEntry(cushioned,prop,'aggregate',start+110000);
 assert.equal(timedOverEntryValid(cushioned,prop,start+110001),true);
 assert.equal(timedOverEntryValid({...cushioned,overVerification:{...cushioned.overVerification,route:'seller_cushion'}},prop,start+110001),false);
});
test('timing proof binds the exact contract and two distinct external checks',()=>{
 const g=state(start+220000),proof={contractKey:overContractKey(g,market),initialAt:start,firstExternalAt:start+20000,firstExternalId:'one',pairedAt:start+220000,pairedExternalId:'two',route:'elapsed'};
 const verified={...g,verificationId:'aggregate',overVerification:proof};rememberIndependentEntry(verified,market,'aggregate',start+220000);assert.equal(timedOverEntryValid(verified,market,start+220001),true);
 assert.equal(timedOverEntryValid(verified,{...market,floor_strike:138.5},start+220001),false);
 assert.equal(timedOverEntryValid({...verified,overVerification:{...proof,firstExternalAt:start+19999}},market,start+220001),false);
 assert.equal(timedOverEntryValid({...verified,overVerification:{...proof,pairedExternalId:'one'}},market,start+220001),false);
});

test('a fresh correction seen only by the fast watcher resets both the clock and first external check',async()=>{
 const h=harness();await h.run(0);await h.run(20000);assert.ok(h.window.first_external_id);
 const corrected=state(start+19999,69,70);
 assert.equal(await h.context.resetLostOverWindow(corrected,market),true);assert.equal(h.window,null);
 await h.run(21000);assert.equal(h.window.initial_at,start+21000);assert.equal(h.window.first_external_id,null);
});
