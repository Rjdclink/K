import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {leadFirstProofValid,leadFirstProofReady,leadFinalProofValid,LEAD_EXTERNAL_WAIT_MS}
 from '../src/lead_verification_timer.mjs';
import {sportsContractKey} from '../src/entry_verification.mjs';
import {verifiedSourceReady} from '../src/external_authority.mjs';
import {pairedExternalMatch} from '../src/independent_match_score.mjs';

const now=1_000_000;
const market={ticker:'KXNHLGAME-TEST-HOME',event_ticker:'KXNHLGAME-TEST',rules_primary:'Home wins'};
const game={id:'g',verifiedLive:true,verificationId:'second'};
const key=sportsContractKey(game,market);
const proof=(age=60000)=>({
 game_id:'g',contract_key:key,first_at:new Date(now-age),
 first_verification_id:'first',first_evidence:{
   source:'ESPN',eventId:'espn-g',gameId:'g',home:3,away:1}
});

test('the lead window requires sixty real seconds and exactly the same contract',()=>{
 assert.equal(LEAD_EXTERNAL_WAIT_MS,60000);
 assert.equal(leadFirstProofReady(proof(59999),game,market,now),false);
 assert.equal(leadFirstProofReady(proof(60000),game,market,now),true);
 assert.equal(leadFirstProofReady(proof(60001),game,market,now),true);
 assert.equal(leadFirstProofReady({...proof(),contract_key:'different'},game,market,now),false);
 assert.equal(leadFirstProofReady({...proof(),game_id:'other'},game,market,now),false);
 assert.equal(leadFirstProofReady({...proof(),first_verification_id:''},game,market,now),false);
 assert.equal(leadFirstProofReady({...proof(),first_evidence:{}},game,market,now),false);
 assert.equal(leadFirstProofReady({...proof(),first_at:new Date(now+1)},game,market,now),false);
});
test('final lead proof requires distinct IDs, matching contract, and expires after ten seconds',()=>{
 const g={...game,independentEntry:{contractKey:key,verificationId:'second',requestedAt:now-1000},
  leadVerification:{contractKey:key,firstId:'first',finalId:'second',firstAt:now-61000,finalAt:now-1000}};
 assert.equal(leadFinalProofValid(g,market,now),true);
 assert.equal(leadFinalProofValid({...g,leadVerification:{...g.leadVerification,firstAt:now-60000}},market,now),false);
 assert.equal(leadFinalProofValid({...g,leadVerification:{...g.leadVerification,finalAt:now-10001}},market,now),false);
 assert.equal(leadFinalProofValid({...g,leadVerification:{...g.leadVerification,firstId:'second'}},market,now),false);
 assert.equal(leadFinalProofValid({...g,verificationId:'other'},market,now),false);
 assert.equal(leadFinalProofValid(g,{...market,ticker:'different'},now),false);
 assert.equal(leadFinalProofValid({...g,leadVerification:null},market,now),false);
});
test('actual entry path initiates first external proof at eligibility and requires a second after sixty seconds',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('let leadExternalWindowsReady;'),end=source.indexOf('async function verifiedEntryQuote(',begin);
 assert.ok(begin>0&&end>begin);
 let at=1_000_000,checks=0,window=null;
 class Clock extends Date{static now(){return at}}
 const context=vm.createContext({
  Date:Clock,JSON,Number,Math,Promise,
  pool:{query:async(sql,args=[])=>{
   if(sql.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};
   if(sql.startsWith('SELECT * FROM lead_external_windows'))return {rows:window?[window]:[]};
   if(sql.startsWith('INSERT INTO lead_external_windows')){
    if(!window)window={market_ticker:args[0],game_id:args[1],contract_key:args[2],
      first_at:new Date(at),first_verification_id:args[3],first_evidence:JSON.parse(args[4])};
    return {rows:[window]};
   }
   throw Error('Unexpected DB '+sql);
  }},
  overContractKey:sportsContractKey,
  leadFirstProofValid:(w,g,m,t=at)=>leadFirstProofValid(w,g,m,t),
  leadFirstProofReady:(w,g,m,t=at)=>leadFirstProofReady(w,g,m,t),
  leadFinalProofValid:(g,m,t=at)=>leadFinalProofValid(g,m,t),
  leadSignal:()=>({strategy:'lead'}),additionalLeadSignal:()=>null,earlyLeadSignal:()=>null,
  basketballCloseoutEntry:()=>false,lateCommandingLead:()=>true,
  verifiedSourceReady:(g,t=at)=>verifiedSourceReady(g,t),pairedExternalMatch,
  auditedOver:async(g,m,opts)=>{
   checks++;g.verificationId='v-'+checks;
   g.externalScore={source:'ESPN',eventId:'espn-g',gameId:g.id,home:3,away:1,checkedAt:at,live:true};
   g.independentEntry={contractKey:sportsContractKey(g,opts.market),
    verificationId:g.verificationId,requestedAt:at};
   return true;
  }
 });
 vm.runInContext(source.slice(begin,end),context);
 const g={id:'g',verifiedLive:true,scoreKnown:true,scoreConsistent:true,period:4,observedAt:at};
 assert.equal(await context.verifyCommandingLead(g,{id:'g'},market),false);
 assert.equal(checks,1);assert.ok(window);
 at+=59999;
 assert.equal(await context.verifyCommandingLead(g,{id:'g'},market),false);
 assert.equal(checks,1);
 at+=1;
 assert.equal(await context.verifyCommandingLead(g,{id:'g'},market),true);
 assert.equal(checks,2);
 assert.equal(leadFinalProofValid(g,market,at),true);
 at+=10001;
 assert.equal(leadFinalProofValid(g,market,at),false);
});
test('a different external game identity on the final read blocks a commanding lead',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function verifyCommandingLead('),
  source.indexOf('async function verifiedEntryQuote('));
 let at=1_000_000,checks=0;
 class Clock extends Date{static now(){return at}}
 const context=vm.createContext({
  Date:Clock,overContractKey:sportsContractKey,leadFirstProofReady,leadFinalProofValid,
  leadFirstCheck:async()=>proof(60000),basketballCloseoutEntry:()=>false,
  lateCommandingLead:()=>true,leadSignal:()=>({strategy:'lead'}),
  verifiedSourceReady:(g,t=at)=>verifiedSourceReady(g,t),pairedExternalMatch,
  auditedOver:async(g,m,opts)=>{
   checks++;g.verificationId='second';
   g.externalScore={source:'ESPN',eventId:'different-fixture',gameId:g.id,home:3,away:1,checkedAt:at,live:true};
   g.independentEntry={contractKey:sportsContractKey(g,opts.market),verificationId:'second',requestedAt:at};
   return true;
  }
 });
 vm.runInContext(section,context);
 const g={...game,scoreKnown:true,scoreConsistent:true};
 assert.equal(await context.verifyCommandingLead(g,{id:'g'},market),false);
 assert.equal(checks,1);
 assert.equal(g.leadVerification,undefined);
});

test('two-goal commanding leads in soccer and hockey require 120 real seconds; other leads retain 60',()=>{
 for(const [type,sport] of [['soccer_tournament_multi_leg','Soccer'],['hockey_match','NHL']]){
  const g={...game,type,sport,homeUnits:2,awayUnits:0,externalScore:{source:'ESPN',home:2,away:0}};
  const k=sportsContractKey(g,market);
  const first={...proof(120000),contract_key:k,first_evidence:{source:'ESPN',eventId:'espn-g',gameId:'g',home:2,away:0}};
  assert.equal(leadFirstProofReady({...first,first_at:new Date(now-119999)},g,market,now),false,type);
  assert.equal(leadFirstProofReady(first,g,market,now),true,type);
  const f={...g,verificationId:'second',independentEntry:{contractKey:k,verificationId:'second',requestedAt:now-500},
   leadVerification:{contractKey:k,firstId:'first',finalId:'second',firstAt:now-61000,
    finalAt:now-500,firstEvidence:first.first_evidence}};
  assert.equal(leadFinalProofValid(f,market,now),false,type+' cannot dispatch at 61 seconds');
  assert.equal(leadFinalProofValid({...f,leadVerification:{...f.leadVerification,firstAt:now-120500}},market,now),true,type+' qualified after 120 seconds');
  const three={...g,homeUnits:3,externalScore:{source:'ESPN',home:3,away:0}};
  const firstThree={...first,first_evidence:{source:'ESPN',eventId:'espn-g',gameId:'g',home:3,away:0},first_at:new Date(now-60000)};
  assert.equal(leadFirstProofReady(firstThree,three,market,now),true,type+' +3 must remain 60 seconds');
 }
});

test('a first external reading of a two-goal lead cannot be shortened by a later three-goal reading',()=>{
 const gameNow={...game,type:'soccer_tournament_multi_leg',sport:'Soccer',homeUnits:3,awayUnits:0,externalScore:{source:'ESPN',home:3,away:0}};
 const k=sportsContractKey(gameNow,market);
 const first={...proof(90000),contract_key:k,first_evidence:{source:'ESPN',eventId:'espn-g',gameId:'g',home:2,away:0}};
 assert.equal(leadFirstProofReady(first,gameNow,market,now),false);
 const final={...gameNow,verificationId:'second',independentEntry:{contractKey:k,verificationId:'second',requestedAt:now-500},
  leadVerification:{contractKey:k,firstId:'first',finalId:'second',firstAt:now-90000,finalAt:now-500,firstEvidence:first.first_evidence}};
 assert.equal(leadFinalProofValid(final,market,now),false);
});
