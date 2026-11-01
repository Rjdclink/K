import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,confirmedOver} from '../src/strategy.mjs';
import {overContractKey,freshOverObservation,freshOverState,overTiming,overCushion,sameOverReading,timedOverEntryValid,OVER_FRESH_MS,OVER_MAX_GAP_MS} from '../src/over_verification.mjs';
const start=Date.parse('2026-11-01T12:00:00Z');
const milestone={id:'game',type:'basketball_game',title:'Boston at New York',details:{league:'NBA'}};
const market={ticker:'KXNBATOTAL-TEST-T139',event_ticker:'KXNBATOTAL-TEST',status:'active',floor_strike:139.5,title:'Over 139.5 total points',rules_primary:'Combined total points scored in the full game',strike_type:'greater',yes_ask_dollars:'.95',yes_ask_size_fp:'100'};
const liveState=(m,raw)=>({...gameState(m,raw),verifiedLive:true});
const state=(at,home=70,away=70)=>liveState(milestone,{milestone_id:'game',_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:home,away_score:away,quarter:3,time_remaining:'5:00',last_updated_ts:at/1000}});
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const runtime=source.slice(source.indexOf('let overWindowsReady;'),source.indexOf('async function auditKalshiOnlyLead('));
function harness({home=70,away=70,seller=true,decisions=[]}={}){
 let time=start,window=null,ids=0,externalCount=0,kalshiCount=0;const events=[],proofs=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
 const context=vm.createContext({Date:Clock,Number,JSON,Math,Promise,console,
  overContractKey,freshOverObservation:g=>freshOverObservation(g,time),freshOverState:(g,m)=>freshOverState(g,m,time),overTiming:(w,g,m,at=time)=>overTiming(w,g,m,at),sameOverReading,timedOverEntryValid:(g,m)=>timedOverEntryValid(g,m,time),OVER_FRESH_MS,OVER_MAX_GAP_MS,
  gameState:liveState,confirmedOver,overSignal,randomUUID:()=>`id-${++ids}`,auditTable:async()=>{},
  pool:{query:async(sql,args=[])=>{
   if(sql.startsWith('CREATE'))return {rows:[],rowCount:0};
   if(sql.startsWith('INSERT INTO over_verification_windows')){
    if(!window||window.contract_key!==args[2]||time-Number(window.last_seen)>OVER_MAX_GAP_MS)window={market_ticker:args[0],game_id:args[1],contract_key:args[2],generation:args[3],initial_at:args[4],last_seen:args[4],contract:JSON.parse(args[5]),initial_state:JSON.parse(args[6]),first_external_at:null,first_external_id:null};
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
  }},reportVerifiedGate:async(g,t,message)=>events.push(['progress',message]),kalshi:async()=>({market}),recoverSummaryAsk:async m=>m,hasAsk:()=>seller,executableQuote:async m=>seller?m:null,
  auditedOver:async(g,m,opts)=>{assert.equal(opts.cache,undefined);events.push(['external',time]);externalCount++;const decision=decisions.length?decisions.shift():true;if(decision===true)g.verificationId='external-'+externalCount;return decision},
  liveMilestone:async(id,opts={})=>{kalshiCount++;events.push(['kalshi-dispatch',time]);opts.onDispatch?.();if(opts.onDispatch)assert.equal(events.at(-1)[0],'external');time+=2;return {milestone_id:'game',details:{status:'live',home_score:home,away_score:away,quarter:3,time_remaining:'5:00',last_updated_ts:time/1000}}}
 });vm.runInContext(runtime,context);
 return {events,proofs,context,get window(){return window},get externalCount(){return externalCount},get kalshiCount(){return kalshiCount},run:async(ms)=>{if(ms!==undefined)time=start+ms;return context.confirmedIndependentOver(state(time-1,home,away),milestone,market)},setScore:(h,a)=>{home=h;away=a},setSeller:v=>{seller=v}};
}
test('uncushioned over waits 20 seconds for external check one and 3:30 for the simultaneous final pair',async()=>{
 const h=harness();assert.equal(await h.run(0),null);assert.equal(h.externalCount,0);assert.equal(h.window.initial_at,start);
 assert.equal(await h.run(19999),null);assert.equal(h.externalCount,0);
 assert.equal(await h.run(20000),null);assert.equal(h.externalCount,1);assert.equal(h.kalshiCount,0);
 for(const ms of [80000,140000,209999])assert.equal(await h.run(ms),null);
 assert.equal(h.externalCount,1);const verified=await h.run(210000);assert.ok(verified);assert.equal(h.externalCount,2);assert.equal(h.kalshiCount,1);
 assert.equal(verified.overVerification.route,'elapsed');assert.equal(verified.overVerification.initialAt,start);assert.equal(verified.overVerification.pairedAt,start+210000);
 assert.deepEqual(h.events.filter(e=>['kalshi-dispatch','external'].includes(e[0])).slice(-2),[['kalshi-dispatch',start+210000],['external',start+210000]]);
 assert.equal(h.proofs.at(-1).mode,'independent_timed_over');assert.equal(timedOverEntryValid(verified,market,start+210003),true);assert.equal(timedOverEntryValid(verified,market,start+220001),false);
});
test('cushion waives only the 3:30 wait, never 20 seconds or either external check',async()=>{
 const h=harness({home:75});assert.equal(await h.run(0),null);assert.equal(await h.run(19999),null);assert.equal(h.externalCount,0);
 const verified=await h.run(20000);assert.ok(verified);assert.equal(h.externalCount,2);assert.equal(h.kalshiCount,1);assert.equal(verified.overVerification.route,'cushion');assert.equal(verified.overVerification.cushionUnits,4);
 assert.equal(timedOverEntryValid(verified,market,start+20003),true);assert.equal(timedOverEntryValid({...verified,home:70},market,start+20003),false);
});
test('seller is required to start; a gap or changed contract starts a new clock',async()=>{
 const h=harness({seller:false});await h.run(0);assert.equal(h.window,null);assert.equal(h.externalCount,0);
 h.setSeller(true);await h.run(10000);assert.equal(h.window.initial_at,start+10000);
 await h.run(100001);assert.equal(h.window.initial_at,start+100001);assert.equal(h.externalCount,0);
 h.window.contract_key='changed';await h.run(100002);assert.equal(h.window.initial_at,start+100002);
});
test('missing and contradictory external readings block even cushioned entries',async()=>{
 for(const decision of [null,false]){
  const h=harness({home:75,decisions:[decision]});await h.run(0);assert.equal(await h.run(20000),null);assert.equal(h.externalCount,1);assert.equal(h.proofs.length,0);if(decision===false)assert.equal(h.window,null);
  const final=harness({home:75,decisions:[true,decision]});await final.run(0);assert.equal(await final.run(20000),null);assert.equal(final.externalCount,2);assert.equal(final.proofs.length,0);if(decision===false)assert.equal(final.window,null);
 }
});
test('lost crossing clears the durable clock; increasing scores preserve it',async()=>{
 const h=harness();await h.run(0);await h.run(20000);h.setScore(72,70);await h.run(80000);assert.equal(h.window.initial_at,start);
 await h.context.pruneOverWindows([{state:state(start+80000,69,70)}]);assert.equal(h.window,null);
});
test('player, team and period cushions use the exact selected statistic',()=>{
 const g={...state(start,75,70),homeTeamId:'ny',awayTeamId:'bos',homeName:'New York',awayName:'Boston'};
 const prop={...market,event_ticker:'KXNBAREB-TEST',title:'Pat Player: 6+ rebounds',yes_sub_title:'Pat Player: 6+',floor_strike:5.5,custom_strike:{basketball_player:'p'}};
 assert.equal(overCushion({...g,playerStats:{p:{rebounds:6}}},prop),null);assert.equal(overCushion({...g,playerStats:{p:{rebounds:7}}},prop),1);
 const team={...market,event_ticker:'KXNBATEAMTOTAL-TEST',title:'New York over 73.5 total points',floor_strike:73.5,custom_strike:{basketball_team:'ny'}};
 assert.equal(overCushion(g,team),null);
 const segment={...market,event_ticker:'KXNBA1QTOTAL-TEST',title:'Over 39.5 total points in 1st quarter',floor_strike:39.5};
 const periods={...g,periodScores:[{number:1,home:21,away:19}]};assert.equal(overCushion(periods,segment),null);assert.equal(sameOverReading(periods,{...periods,periodScores:[{number:1,home:22,away:19}]},segment),false);
});
test('timing proof binds the exact contract and two distinct external checks',()=>{
 const g=state(start+220000),proof={contractKey:overContractKey(g,market),initialAt:start,firstExternalAt:start+20000,firstExternalId:'one',pairedAt:start+220000,pairedExternalId:'two',route:'elapsed'};
 const verified={...g,verificationId:'aggregate',overVerification:proof};assert.equal(timedOverEntryValid(verified,market,start+220001),true);
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
