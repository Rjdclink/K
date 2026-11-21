import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPriorityGate,apiPriority,withApiPriority} from '../src/api_priority.mjs';

function stalledGate(){
 let release,waiting=true;
 const ordered=[],queue=createPriorityGate(async priority=>{
  if(waiting)return 500;
  ordered.push(priority);return 0;
 },{wait:()=>new Promise(resolve=>{release=resolve})});
 return {queue,ordered,unstall:()=>{waiting=false;release()}};
}

test('due preflight final outranks catalog, normal, interactive and routine live requests',async()=>{
 const gate=stalledGate();
 const jobs=[gate.queue('background'),gate.queue('live'),gate.queue('interactive'),
  gate.queue('normal')];
 await new Promise(r=>setImmediate(r));
 jobs.push(gate.queue('preflight'),gate.queue('preflight_final'));
 gate.unstall();await Promise.all(jobs);
 assert.deepEqual(gate.ordered.slice(0,2),['preflight_final','preflight']);
});

test('new due final preflight must not yield to fairness after continuous routine live traffic',async()=>{
 const gate=stalledGate();
 const jobs=Array.from({length:10},()=>gate.queue('live'));
 jobs.push(gate.queue('background'));await new Promise(r=>setImmediate(r));
 jobs.push(gate.queue('preflight_final'));gate.unstall();await Promise.all(jobs);
 assert.equal(gate.ordered[0],'preflight_final');
});

test('safety-critical protective exits retain highest urgency alongside final preflight',async()=>{
 const gate=stalledGate();
 const jobs=[gate.queue('background'),gate.queue('normal'),gate.queue('live')];
 await new Promise(r=>setImmediate(r));
 jobs.push(gate.queue('risk_exit'),gate.queue('preflight_final'));
 gate.unstall();await Promise.all(jobs);
 assert.deepEqual(gate.ordered.slice(0,2),['risk_exit','preflight_final']);
});

test('async preflight context propagates to Kalshi requests while other jobs retain independent priority',async()=>{
 const seen=await Promise.all(['preflight_final','preflight','risk_exit','background']
  .map(priority=>withApiPriority(priority,async()=>{await new Promise(r=>setImmediate(r));return apiPriority()})));
 assert.deepEqual(seen,['preflight_final','preflight','risk_exit','background']);
});

test('tick launches priority preflights before discovery and other market scanners',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const tick=src.slice(src.indexOf("if(req.method==='POST'&&url.pathname==='/tick')"),
   src.indexOf("if(req.method==='GET'&&url.pathname==='/login')"));
 assert.ok(tick.indexOf('const entryRecheckJob=')>=0);
 assert.ok(tick.indexOf('const entryRecheckJob=')<tick.indexOf('const discoveryJob='));
 assert.ok(tick.indexOf('const entryRecheckJob=')<tick.indexOf('const readyOverJob='));
 assert.match(tick,/withApiPriority\('preflight_final',\(\)=>watchEntryRechecks\(until\)\)/);
 assert.match(tick,/withApiPriority\('preflight',\(\)=>watchReadyOverTickets\(until\)\)/);
 assert.match(tick,/withApiPriority\('preflight',\(\)=>watchLeadWindows\(until\)\)/);
 assert.match(tick,/withApiPriority\('risk_exit',\(\)=>watchCorrectedOvers\(until\)\)/);
});

test('final NO verification has first-priority external and exchange checks and does not block on retry telemetry',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/await withApiPriority\('preflight_final',\(\)=>runImmediateNoFinalPass\(/);
 assert.match(src,/await withApiPriority\('preflight',\(\)=>scanCollegeTotalNos\(/);
 const checkpoint=src.slice(src.indexOf('const noFinalCheckpoint=async options=>'),
   src.indexOf('const json=',src.indexOf('const noFinalCheckpoint=async options=>')));
 assert.match(checkpoint,/void entryRechecks\.register\(/);
 assert.doesNotMatch(checkpoint,/await entryRechecks\.register\(/);
});

test('exchange rate limiter recognizes dedicated preflight and protective exit priorities as live',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/const priorityLiveRead=/);
 for(const p of ['preflight_final','preflight','risk_exit'])
  assert.ok(src.includes("'"+p+"'"),'missing '+p);
 assert.match(src,/priorityLiveRead\(priority\)/);
});

test('preflight tickets must not yield to background after four higher-priority admissions',async()=>{
 const gate=stalledGate();
 const jobs=[gate.queue('background')];
 await new Promise(r=>setImmediate(r));
 jobs.push(...Array.from({length:9},()=>gate.queue('preflight_final')));
 gate.unstall();await Promise.all(jobs);
 assert.deepEqual(gate.ordered.slice(0,9),Array(9).fill('preflight_final'));
 assert.equal(gate.ordered[9],'background');
});

test('nonessential shard staging and combo discovery do not precede NO final or initial preflights',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const scan=src.slice(src.indexOf('async function scan('),src.indexOf('async function settlementAlerts('));
 const final=scan.indexOf("withApiPriority('preflight_final',()=>runImmediateNoFinalPass(");
 const first=scan.indexOf("withApiPriority('preflight',()=>scanCollegeTotalNos(");
 const staging=scan.indexOf('await stageCashAcrossShards(account,bankroll)');
 const combo=scan.indexOf('const comboJob=live()?fillComboQueue.enqueue(');
 assert.ok(final>=0&&first>final);
 assert.ok(staging>first,'optional shard rebalancing must not delay score verification');
 assert.ok(combo>first,'held combo research must not start before preflight verification');
});

test('a game-level urgent NO retry checks full-game and segment preflights independently',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const section=src.slice(src.indexOf('async function retryGroupedNoTickets('),src.indexOf('async function watchEntryRechecks('));
 assert.match(section,/if\(state\.sport==='NHL'\)\s*\{/);
 assert.match(section,/if\(state\.sport==='Soccer'\)\s*\{/);
 for(const route of ["scanHockeyTotalNos(games,events,sink,'final')",
  "scanEarlyPeriodNos(games,events,sink,'NHL','final')",
  "scanSoccerTotalNos(games,events,sink,'final')",
  "scanEarlyPeriodNos(games,events,sink,'Soccer','final')"])
  assert.ok(section.includes(route),'missing route '+route);
 assert.doesNotMatch(section,/if\(state\.sport==='NHL'\)count=\[1,2\]/);
 assert.doesNotMatch(section,/if\(state\.sport==='Soccer'\)count=state\.period===1/);
});