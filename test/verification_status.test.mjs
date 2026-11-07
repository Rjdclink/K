import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationStatus,completedOverWait,verificationWindowStatus} from '../src/verification_status.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('dashboard separates absent soccer coverage from a conflicting independent score',()=>{
  assert.match(verificationStatus({passed:false,independent_unavailable:'true'}),/No matching external live score; entry blocked/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false'}),/disagrees with Kalshi/);
  assert.match(verificationStatus({passed:false,independent_unavailable:'false',verification_issue:'ESPN goal list confirms 1 of 2 displayed goals'}),/confirms 1 of 2/);
  assert.match(verificationStatus({passed:true,independent_unavailable:'false'}),/External score matched; fresh Kalshi read/);
  assert.match(verificationStatus({passed:true,mode:'kalshi_only_crossed_over'}),/Two Kalshi score checks passed/);
  assert.match(verificationStatus({passed:true,mode:'seller_backed_cushioned_over'}),/Cushioned over; live seller checked/);
});
test('a completed second external check supersedes only its own pending wait',()=>{
  const signal={verification_wait:{updatedAt:1000}};
  assert.equal(completedOverWait(signal,{passed:true,mode:'independent_timed_over',created_at:new Date(2000).toISOString()}),true);
  assert.equal(completedOverWait(signal,{passed:true,mode:'independent_timed_over',created_at:new Date(999).toISOString()}),false);
  assert.equal(completedOverWait(signal,{passed:false,mode:'independent_timed_over',created_at:new Date(2000).toISOString()}),false);
  assert.equal(completedOverWait(signal,{passed:true,mode:'first_external',created_at:new Date(2000).toISOString()}),false);
});
test('dashboard uses the durable window stage instead of an older wait message',()=>{
  const now=200000,signal={verification_wait:{dueAt:100000,updatedAt:100000}};
  const window={initial_at:100000,last_seen:now-3000,first_external_at:150000};
  const waiting=verificationWindowStatus(signal,window,{stage:'final_wait',remainingMs:37000,minimumMs:137000},now);
  assert.match(waiting.execution,/First external check passed.*37s remaining/);
  assert.deepEqual(waiting.wait,{dueAt:now+37000,updatedAt:now-3000});
  const first=verificationWindowStatus(signal,window,{stage:'first_wait',remainingMs:20000,minimumMs:137000},now);
  assert.deepEqual(first.wait,{dueAt:120000,updatedAt:now-3000});
  assert.match(verificationWindowStatus(signal,window,{stage:'paired'},now).execution,/Waiting period complete; paired external and Kalshi check pending/);
  const delayed=verificationWindowStatus(signal,{...window,last_seen:now-90001},{stage:'final_wait',remainingMs:37000,minimumMs:137000},now);
  assert.match(delayed.execution,/recheck delayed/);
  assert.equal(delayed.wait,undefined);
});
test('an old verification window cannot hide the actual liquidity, cash, or entry blocker',()=>{
  const window={initial_at:1000,last_seen:1000};
  for(const execution of ['No ask liquidity','Insufficient available cash','Below profit floor','Already filled','Player-prop entry window closed']){
    const status=verificationWindowStatus({execution,verification_wait:{}},window,{stage:'paired'},200000);
    assert.equal(status.execution,execution);
    assert.equal(status.wait,undefined);
  }
  const status=verificationWindowStatus({execution:'Waiting for first external check (1s; minimum 20s)',
    ask:'1.0000',ask_size:'0',verification_wait:{}},window,{stage:'first_external'},200000);
  assert.match(status.execution,/No ask liquidity/);
  assert.equal(status.wait,undefined);
});
test('a due timer reports the current generation provider failure instead of an endless pending message',()=>{
  const signal={execution:'First external check passed; waiting for paired checks (1s remaining)',verification_wait:{}};
  const window={initial_at:1000,last_seen:190000};
  const record={passed:false,created_at:new Date(190001).toISOString(),independent_unavailable:'true',
    verification_issue:'External verification unavailable: ESPN: no exact matching fixture; Sportradar: HTTP 429'};
  const result=verificationWindowStatus(signal,window,{stage:'paired'},200000,record);
  assert.equal(result.execution,record.verification_issue);
  assert.equal(result.checkedAt,record.created_at);
  assert.equal(result.wait,undefined);
  const prior={...record,created_at:new Date(500).toISOString()};
  assert.match(verificationWindowStatus(signal,window,{stage:'paired'},200000,prior).execution,/Waiting period complete/);
  assert.match(verificationWindowStatus(signal,window,{stage:'first_external'},200000).execution,/20s wait complete/);
});
test('the dashboard state pipeline preserves no-seller status and surfaces failed external requests',async()=>{
  const now=Date.now(),windows=[
    {market_ticker:'NO-ASK',game_id:'g',initial_at:now-3600000,last_seen:now-3500000},
    {market_ticker:'FAIL',game_id:'g',initial_at:now-200000,last_seen:now-1000},
    {market_ticker:'WAIT',game_id:'g',initial_at:now-5000,last_seen:now-1000}
  ];
  const signals=[{ticker:'NO-ASK',strategy:'over',execution:'No ask liquidity',ask:'1.0000',ask_size:'0.00'},
    {ticker:'FAIL',strategy:'over',execution:'Waiting for first external check (1s; minimum 20s)',ask:'.95',ask_size:'4',verification_wait:{dueAt:now-180000,updatedAt:now-1000}},
    {ticker:'WAIT',strategy:'over',execution:'Awaiting score verification',ask:'.95',ask_size:'4'}];
  const records=[{market_ticker:'FAIL',passed:false,created_at:new Date(now-500).toISOString(),
    independent_unavailable:'true',verification_issue:'External verification unavailable: Sportradar: HTTP 429'}];
  const snap={rows:[{id:'g',scanned_at:new Date(now-1000).toISOString(),signals}]};
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const checked=new Map();',source.indexOf('async function state()'));
  const end=source.indexOf('  for(const game of snap.rows){\n    // Early games',start);
  const context=vm.createContext({snap,Date,Map,Set,Number,Boolean,
    verificationStatus,completedOverWait,verificationWindowStatus,
    overTiming:window=>window.market_ticker==='WAIT'?{stage:'first_wait',remainingMs:15000,minimumMs:180000}:{stage:'first_external'},
    pool:{query:async sql=>({rows:sql.includes('FROM verification_records')?records:windows})}});
  await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.equal(signals[0].execution,'No ask liquidity');
  assert.equal(signals[0].verification_wait,undefined);
  assert.equal(signals[1].execution,records[0].verification_issue);
  assert.equal(signals[1].verification_wait,undefined);
  assert.equal(signals[1].verification_checked_at,records[0].created_at);
  assert.equal(signals[2].verification_wait.dueAt,windows[2].initial_at+20000);
});
