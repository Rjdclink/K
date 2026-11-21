import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleNoFinal,runImmediateNoFinalPass,launchImmediateNoFinalFixtures,immediateNoFinalProof,dueNoFinalWindows} from '../src/no_final_priority.mjs';
import {NO_PREFLIGHT_POLICY} from '../src/late_no_preflight.mjs';

const initial=(ageMs=31000)=>({
 game_id:'game',contract_key:'market-v1',period:3,first_clock:420,
 first_at:new Date(Date.now()-ageMs),
 first_evidence:{source:'ESPN',eventId:'matched',preflight_policy:NO_PREFLIGHT_POLICY}
});
const game={id:'game',period:3};

test('final verification is due immediately at thirty elapsed seconds and a valid entry clock',()=>{
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359}),true);
 assert.equal(eligibleNoFinal(initial(29000),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359}),false);
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:360}),false);
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:0}),false);
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:0,allowZeroClock:true}),true);
});

test('final fast lane refuses invalid first proofs, mismatched contracts, or future timestamps',()=>{
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'changed',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359}),false);
 assert.equal(eligibleNoFinal(initial(),{...game,period:2},{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359}),false);
 assert.equal(eligibleNoFinal(initial(),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359,
   validFirst:()=>false}),false);
 assert.equal(eligibleNoFinal(initial(-5000),game,{contractKey:'market-v1',
   firstSeconds:420,entrySeconds:360,remainingSeconds:359}),false);
});

test('all sports launch their due final checks concurrently before any first-check scanning',async()=>{
 const started=[],resolvers=[],finished=[];
 const groups=['football','basketball','soccer','NHL'].map(sport=>({
   sport,run:()=>new Promise(resolve=>{started.push(sport);resolvers.push(()=>{finished.push(sport);resolve(1)})})
 }));
 let complete=false;
 const job=runImmediateNoFinalPass(groups).then(value=>{complete=true;return value});
 await Promise.resolve();
 await Promise.resolve();
 assert.deepEqual(started,['football','basketball','soccer','NHL'],
   'a slow sport must never prevent another sport beginning its ESPN final check');
 assert.equal(complete,false);
 for(const resolve of resolvers)resolve();
 assert.equal(await job,4);
 assert.equal(complete,true);
 assert.deepEqual(finished,['football','basketball','soccer','NHL']);
});


test('all eligible fixtures launch final ESPN checks at once; multiple strike lines share one scoreboard response',async()=>{
 const started=[],release=new Map(),cards=[
  {market:'a1',game:'a'},{market:'a2',game:'a'},{market:'b1',game:'b'}
 ];
 const checks=launchImmediateNoFinalFixtures(cards,{
  key:c=>c.game,
  verify:c=>new Promise(resolve=>{
   started.push(c.game);release.set(c.game,()=>resolve({game:{id:c.game,home:1,away:0,period:3},
     proof:{source:'ESPN',eventId:c.game,requestId:'second-'+c.game}}));
  })
 });
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(started,['a','b'],'a busy game cannot block another due fixture');
 assert.equal(checks.size,2,'two separate strike lines in game A require just one new ESPN scoreboard response');
 for(const done of release.values())done();
 const readingA=await immediateNoFinalProof(checks,'a',{id:'a',home:1,away:0,period:3},
  ()=>{throw Error('unexpected second ESPN request')});
 const readingAgain=await immediateNoFinalProof(checks,'a',{id:'a',home:1,away:0,period:3},
  ()=>{throw Error('unexpected second ESPN request')});
 assert.deepEqual(readingA,readingAgain);
 assert.equal(readingA.eventId,'a');
 let fallback=0;
 const changed=await immediateNoFinalProof(checks,'a',{id:'a',home:2,away:0,period:3},
  async()=>{fallback++;return {source:'ESPN',eventId:'fresh'}} );
 assert.equal(fallback,1,'changed scores never reuse older evidence');
 assert.equal(changed.eventId,'fresh');
 const stale=await immediateNoFinalProof(checks,'a',{id:'a',home:1,away:0,period:3},
  async()=>({source:'ESPN',eventId:'after-eight-seconds'}),{now:Date.now()+9000});
 assert.equal(stale.eventId,'after-eight-seconds','proofs older than eight seconds are fetched again');
});

test('due final windows require a known window table and one batch lookup',async()=>{
 const sql=[],results=await dueNoFinalWindows(async(statement,parameters)=>{
  sql.push([statement,parameters]);return {rows:[{market_ticker:'KXNHLTOTAL-A-5',
    game_id:'g1',first_at:new Date(),first_evidence:{source:'ESPN',eventId:'id'}}]};
 },'hockey_total_no_windows_v2',['g1','g2']);
 assert.equal(sql.length,1);
 assert.ok(sql[0][0].includes('first_at<='));
 assert.deepEqual(sql[0][1],[['g1','g2']]);
 assert.equal(results.get('KXNHLTOTAL-A-5').game_id,'g1');
 await assert.rejects(()=>dueNoFinalWindows(async()=>({rows:[]}), 'malicious;drop table',['g1']),
  /Unsupported NO preflight table/);
});


test('one failing sport never delays or cancels another sport final',async()=>{
 const calls=[],errors=[];
 const total=await runImmediateNoFinalPass([
  {sport:'football',run:()=>{calls.push('football');throw Error('exchange busy')}},
  {sport:'soccer',run:async()=>{calls.push('soccer');return 1}},
  {sport:'NHL',run:async()=>{calls.push('NHL');return 2}}
 ],{onError:(sport,error)=>errors.push([sport,error.message])});
 assert.deepEqual(calls,['football','soccer','NHL']);
 assert.equal(total,3);
 assert.deepEqual(errors,[['football','exchange busy']]);
});