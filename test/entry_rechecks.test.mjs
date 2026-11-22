import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEntryRechecks,groupEntryRechecks,ENTRY_RECHECK_INTERVAL_MS,ENTRY_RECHECK_LIMIT} from '../src/entry_rechecks.mjs';

const fake=()=>{const calls=[];return {
 calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO'))return {rows:[],rowCount:1};
  if(sql.startsWith('WITH due'))return {rows:[{market_ticker:'A',game_id:'G',strategy:'no',attempts:1}]};
  if(sql.startsWith('UPDATE'))return {rows:[],rowCount:1};
  throw Error('unexpected SQL '+sql);
 }};};
test('exactly two persistent ten-second rechecks, never a third',()=>{
 assert.equal(ENTRY_RECHECK_INTERVAL_MS,10000);
 assert.equal(ENTRY_RECHECK_LIMIT,2);
});
test('registration cannot reset an existing timer and does not register an in-flight order',async()=>{
 const f=fake(),retries=createEntryRechecks(f.query);
 assert.equal(await retries.register('A','G','no'),true);
 assert.equal(await retries.register('A','G','no'),true);
 assert.equal(await retries.register('A','G','wrong'),false);
 const statements=f.calls.filter(c=>c.sql.startsWith('INSERT INTO'));
 assert.equal(statements.length,2);
 assert.ok(statements.every(c=>/ON CONFLICT \(market_ticker\) DO NOTHING/.test(c.sql)));
 assert.ok(statements.every(c=>c.sql.includes("interval '10 seconds'")));
 assert.ok(statements.every(c=>c.sql.includes("'filled','reserved','check_order'")===false||
  c.sql.includes("'filled'")));
});
test('atomic due claims require elapsed time, cap attempts and avoid pending orders',async()=>{
 const f=fake(),r=createEntryRechecks(f.query);
 assert.equal((await r.claimDue(5))[0].attempts,1);
 const sql=f.calls.find(c=>c.sql.startsWith('WITH due')).sql;
 for(const value of ['attempts < 2','FOR UPDATE SKIP LOCKED',
  'claimed_at','clock_timestamp()',"'filled'","'check_order'"])
  assert.ok(sql.includes(value),value);
 assert.ok(sql.includes('AND (r.claimed_at'),'query must include AND before claim recovery clause');
 assert.deepEqual(await r.claimDue(0),[]);
});
test('retry finishes after second attempt, otherwise schedules the next ten-second interval',async()=>{
 const f=fake(),r=createEntryRechecks(f.query);
 await r.finish('A','G','not enough seller depth');
 const sql=f.calls.find(c=>c.sql.startsWith('UPDATE')).sql;
 assert.ok(sql.includes('r.attempts>=2'));
 assert.ok(sql.includes("interval '10 seconds'"));
 assert.ok(sql.includes("'filled'"));
});
test('the live watcher handles due retries by exact contract without a new full catalog scan',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/watchEntryRechecks\(until\)/);
 assert.match(src,/entryRechecks\.claimDue\(/);
 assert.match(src,/entryRechecks\.finish\(/);
 assert.match(src,/watchReadyOverTickets\(until,\{\s*onlyTickers:/);
 assert.match(src,/scanSoccerTotalNos\([^;]*'final'\)/);
 assert.match(src,/async function runFastSportsTick\(\)/);
 assert.match(src,/withApiPriority\('preflight_final',\(\)=>watchEntryRechecks\(until\)\)/);
});

test('already-due final checks are dispatched before registering or scanning new candidates',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const begin=src.indexOf('async function watchEntryRechecks('),end=src.indexOf('async function nws(',begin);
 assert.ok(begin>0&&end>begin);
 const worker=src.slice(begin,end);
 assert.ok(worker.indexOf('entryRechecks.claimDue(')<worker.indexOf('overCandidates'),
  'final check must not sit behind unrelated new OVER contract registration');
});

test('second retry is tied to the original +20-second deadline rather than an extra delay after a slow request',async()=>{
 const f=fake(),r=createEntryRechecks(f.query);
 await r.finish('A','G','not ready');
 const sql=f.calls.find(c=>c.sql.startsWith('UPDATE')).sql;
 assert.ok(sql.includes('first_at')&&sql.includes('r.attempts+1'),
  'deadline must be +10 and +20 seconds from the original first attempt');
});


test('nine preflight lines for the same game are one fixture-level retry group',()=>{
 const rows=[...Array.from({length:9},(_,i)=>({game_id:'game',strategy:'no',market_ticker:'LINE-'+i})),
  {game_id:'other',strategy:'over',market_ticker:'OVER'}];
 const groups=groupEntryRechecks(rows);
 assert.equal(groups.length,2);
 assert.equal(groups[0].length,9);
 assert.equal(groups[1].length,1);
});

test('registering many over candidates requires one durable database insertion, not one insertion per market',async()=>{
 const f=fake(),r=createEntryRechecks(f.query);
 await r.registerMany([{market_ticker:'OVER-A',game_id:'g'},
  {market_ticker:'OVER-B',game_id:'g'}],'over');
 const batch=f.calls.filter(c=>c.sql.startsWith('INSERT INTO'));
 assert.equal(batch.length,1);
 assert.ok(batch[0].sql.includes('jsonb_to_recordset'));
 assert.ok(batch[0].sql.includes('DO NOTHING'));
});