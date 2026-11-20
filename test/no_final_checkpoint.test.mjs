import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoFinalCheckpoint} from '../src/no_final_checkpoint.mjs';

const game={id:'game-1',home:3,away:2,period:3,periodScores:[{home:1,away:1},{home:1,away:0},{home:1,away:1}]};
const first={first_at:'2026-11-20T20:00:00.000Z',first_evidence:{source:'ESPN',eventId:'espn-99',gameId:'game-1',home:3,away:2}};
const c={market:{ticker:'TOTAL-7'},game,first};
const reading={source:'ESPN',eventId:'espn-99',gameId:'game-1',home:3,away:2};
function store(){
  const saved=new Map(),history=[];let calls=0;
  const sql=async(statement,args=[])=>{
    if(statement.startsWith('CREATE TABLE'))return {rows:[]};
    if(statement.startsWith('SELECT')){const row=saved.get(args[0]);return {rows:row?[row]:[]};}
    if(statement.startsWith('INSERT INTO no_final_preflight_checks')){
      const [ticker,gameId,firstAt,scoreKey,proof,at]=args;
      saved.set(ticker,{market_ticker:ticker,game_id:gameId,first_at:firstAt,score_key:scoreKey,final_evidence:JSON.parse(proof),final_at:at});
      return {rows:[]};
    }
    if(statement.startsWith('INSERT INTO verification_records')){history.push(args);return {rows:[]};}
    throw Error('Unknown checkpoint SQL '+statement);
  };
  return {sql,saved,history,get calls(){return calls},increment:()=>calls++};
}
const approved=(a,b,g)=>a.source===b.source&&a.eventId===b.eventId&&b.home===g.home&&b.away===g.away;
test('exactly one successful second independent check is saved, even with zero asks, no cash, or expired no-ask timer',async()=>{
 const db=store(),final=createNoFinalCheckpoint(db.sql),verify=async()=>{db.increment();return reading};
 const r1=await final({...c,verify,approve:approved,validate:()=>true});
 assert.equal(r1.ok,true);assert.equal(r1.newCheck,true);assert.equal(db.calls,1);
 const r2=await final({...c,verify,approve:approved,validate:()=>true});
 assert.equal(r2.ok,true);assert.equal(r2.newCheck,false);
 assert.equal(db.history.length,1,'first completed final verification persisted independently of buy attempt');
 assert.equal(db.saved.size,1);
});
test('current score change or a different initial proof always requires fresh final confirmation',async()=>{
 const db=store(),final=createNoFinalCheckpoint(db.sql);let calls=0;
 let current=game;const verify=async()=>{calls++;return {...reading,home:current.home,away:current.away}};
 assert.equal((await final({...c,verify,approve:approved,validate:()=>true})).ok,true);
 const newer={...game,home:4};current=newer;
 assert.equal((await final({...c,game:newer,verify,approve:approved,validate:()=>true})).ok,true);
 assert.equal(calls,2);
 const next={...first,first_at:'2026-11-20T20:02:00.000Z'};current=game;
 assert.equal((await final({...c,first:next,verify,approve:approved,validate:()=>true})).ok,true);
 assert.equal(calls,3);
});
test('external source disagreement and ambiguous proof fail closed without recording success',async()=>{
 const db=store(),final=createNoFinalCheckpoint(db.sql);
 const failure=await final({...c,verify:async()=>({...reading,home:4}),approve:approved,validate:()=>true});
 assert.equal(failure.ok,false);assert.equal(db.history.length,0);
 const missing=await final({...c,verify:async()=>null,approve:approved,validate:()=>true});
 assert.equal(missing.ok,false);assert.equal(db.saved.size,0);
});