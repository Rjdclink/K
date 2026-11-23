import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const sections=[
 ['college basketball and football','async function scanCollegeTotalNos(','async function scanHockeyTotalNos('],
 ['NHL full-game NO','async function scanHockeyTotalNos(','async function scanEarlyPeriodNos('],
 ['NHL/soccer/NBA early periods','async function scanEarlyPeriodNos(','async function scanSoccerTotalNos('],
 ['soccer full-game NO','async function scanSoccerTotalNos(','async function scanNoncushionedPlayerOvers(']
];
for(const [label,start,end] of sections){
 test(label+': no final independent ESPN check until executable depth, cash, shared cap and fees all pass',()=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  assert.ok(a>=0&&b>a,'valid scanner boundaries '+label);
  const scan=source.slice(a,b);
  const first=scan.indexOf('if(invalidWindow)')>=0?scan.indexOf('if(invalidWindow)'):
    scan.indexOf('if(invalid)')>=0?scan.indexOf('if(invalid)'):
      scan.indexOf('!validNoPreflight(window');
  const quote=scan.indexOf("+'/orderbook'");
  const risk=scan.indexOf('profitableCount(quantity,ask.price,fees');
  const final=scan.indexOf('const finalCheck=await noFinalCheckpoint(');
  const refreshed=scan.indexOf('const proof=finalCheck')>=0?scan.indexOf('const proof=finalCheck'):
    scan.indexOf('const proof=finalCheck?.newCheck');
  assert.ok(first>=0&&quote>first&&risk>quote&&final>risk&&refreshed>final,
    'first proof remains, but actual NO book and profitability precede second ESPN verification '+label);
  assert.ok(!scan.includes('launchImmediateNoFinalFixtures('),
    'no fixture-wide ESPN final requests may launch before the executable book is inspected '+label);
  assert.match(scan,/if\(!ask\|\|ask\.size<minimumCount\(current\)/,
    'must validate executable price and size, not a displayed summary quote '+label);
  assert.match(scan,/noDepthAtAsk\(orderbook_fp,ask\.price,ask\.size\)/,
    'must inspect full NO orderbook depth '+label);
  assert.match(scan,/await noFinalCheckpoint\(/,'valid score confirmation remains mandatory');
 });
}

test('missing executable NO quote schedules two existing ten-second retry attempts without launching ESPN',()=>{
 const scans=sections.map(([_,a,b])=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+1)));
 for(const scan of scans){
  const missing=scan.indexOf('noAskTimeout.observeMissing(');
  const recheck=scan.indexOf('scheduleNoLiquidityRecheck(');
  const final=scan.indexOf('const finalCheck=await noFinalCheckpoint(');
  assert.ok(missing>=0&&recheck>missing&&recheck<final,
    'retry must be queued at the first empty executable orderbook before new external requests');
 }
});

test('a final proof still has a ten-second dispatch freshness rule and keeps first-vs-second source checks',()=>{
 for(const [label,a,b] of sections){
  const scan=source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+1));
  assert.ok(scan.includes('noFinalCheckpoint('),label);
  assert.match(scan,/lateNoPreflightProgress\(window(?:,Date\.now\(\),[^)]*)?\)/,label);
  assert.match(scan,/finalCheck\??\.newCheck&&Date\.now\(\)-finalCheck\.at<8000/,label);
  assert.match(scan,/Date\.now\(\)-externalCheckedAt>10000/,label);
 }
});
