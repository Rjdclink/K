import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('concurrent candidate games share short-lived league scoreboard while fresh final checks bypass this cache',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const a=source.indexOf('const sourceScoreReads=new Map();');
 const b=source.indexOf('async function externallyScoredGame(',a);
 assert.ok(a>=0&&b>a);
 let calls=0,now=1000000;
 class Clock extends Date{static now(){return now}}
 const ctx=vm.createContext({Date:Clock,Map,Error,fetch:async()=>{
  calls++;return {ok:true,json:async()=>({events:[{id:'game',score:calls}]})};
 }});
 vm.runInContext(source.slice(a,b),ctx);
 const [first,other]=await Promise.all([
  ctx.sharedCandidateScoreboardFetch('https://espn.test/scores'),
  ctx.sharedCandidateScoreboardFetch('https://espn.test/scores')
 ]);
 assert.equal(calls,1);
 assert.equal((await first.json()).events[0].score,1);
 assert.equal((await other.json()).events[0].score,1);
 now+=2100;
 const newScore=await ctx.sharedCandidateScoreboardFetch('https://espn.test/scores');
 assert.equal(calls,2);
 assert.equal((await newScore.json()).events[0].score,2);
 assert.match(source,/fetcher:fresh\?fetch:sharedCandidateScoreboardFetch/);
});
