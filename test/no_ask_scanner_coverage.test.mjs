import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NO_ASK_GRACE_MS,NO_ASK_RETIRED} from '../src/no_ask_timeout.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const region=(first,last)=>source.slice(source.indexOf(first),source.indexOf(last,source.indexOf(first)));
test('all four NO total scanners check executable liquidity and profitability before final score verification',()=>{
 for(const [begin,end] of [
  ['async function scanCollegeTotalNos(','async function scanHockeyTotalNos('],
  ['async function scanHockeyTotalNos(','async function scanEarlyPeriodNos('],
  ['async function scanEarlyPeriodNos(','async function scanSoccerTotalNos('],
  ['async function scanSoccerTotalNos(','async function scanVariablePlayerOvers(']]){
  const code=region(begin,end);
  assert.ok(code.indexOf('const finalCheck=')>=0,begin+' must actually attempt final verification');
  assert.doesNotMatch(code,/if\(await noAskTimeout\.isRetired\(c,'no'\)&&/,begin+' a saved qualifying first proof must survive absent liquidity');
  assert.ok(code.indexOf('const {orderbook_fp}=await kalshi(')<code.indexOf('const finalCheck='),begin+' check depth before ESPN');
  assert.ok(code.indexOf('profitableCount(quantity,ask.price,fees')<code.indexOf('const finalCheck='),begin+' check net profit before ESPN');
  assert.match(code,/Verified ESPN preflight retained; no executable NO seller/,begin+' a missing book cannot erase a saved proof');
  assert.match(code,/noAskTimeout\.observeMissing\(c,'no'\)/,begin);
  assert.match(code,/noAskTimeout\.available\(\[c\],'no'\)/,begin);
 }
});
test('legacy Q3 football NO, variable player YES, fast lead and fast over also stop buying after thirty seconds',()=>{
 const checks=[
  ['async function scanThirdQuarterNos(','async function nws(',/noAskTimeout\.retired\(highest,'no'\)/,/noAskTimeout\.observeMissing\(candidate,'no'\)/],
  ['async function scanVariablePlayerOvers(','async function scan(cachedMilestones',/noAskTimeout\.isRetired\(c,'yes'\)/,/noAskTimeout\.observeMissing\(c,'yes'\)/],
  ['async function watchLeadWindows(','async function watchReadyOverTickets(',/verifiedEntryQuote\(second,milestone,offered,scoreboardCache\)/,/noAskTimeout\.observeMissing\(\{market,game:first\},'yes'\)/],
  ['async function watchReadyOverTickets(','async function nws(',/noAskTimeout\.isRetired\(\{market:\{ticker:ticket.ticker\}/,/noAskTimeout\.observeMissing\(\{market:current,game:state\},'yes'\)/]
 ];
 for(const [begin,end,retired,missing] of checks){
  const code=region(begin,end);
  assert.match(code,retired,begin);assert.match(code,missing,begin);
 }
});
test('normal winner/over purchases are skipped but retained positions still have their own sell and settlement routes',()=>{
 const scan=region('async function scan(cachedMilestones','async function refreshOpenClocks(');
 assert.match(scan,/const retiredYes=live\(\)\?await noAskTimeout\.retired\(yesCandidates,'yes'\)/);
 assert.match(scan,/opportunities\.push\(\.\.\.allCandidates\.filter\(stillEligible\)\)/);
 assert.match(scan,/const activeYesCandidates=allCandidates\.filter\(stillEligible\)/);
 assert.match(scan,/retiredYes\.has\(noAskKey\(c\)\)\?NO_ASK_RETIRED/);
 assert.match(source,/async function verifiedEntryQuote\([\s\S]*?await executableQuote\(current\)/);
 assert.equal(NO_ASK_GRACE_MS,30_000);
 assert.match(NO_ASK_RETIRED,/live book recovery check pending/);
 const sell=readFileSync(new URL('../src/sell.mjs',import.meta.url),'utf8');
 const positions=readFileSync(new URL('../src/positions.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(sell,/noAskTimeout|no_ask_timeouts/);
 assert.doesNotMatch(positions,/noAskTimeout|no_ask_timeouts/);
});
test('a recorded qualifying first ESPN NO proof rechecks live book despite a 30-second retired timer',()=>{
 for(const [begin,end] of [
  ['async function scanCollegeTotalNos(','async function scanHockeyTotalNos('],
  ['async function scanHockeyTotalNos(','async function scanEarlyPeriodNos('],
  ['async function scanEarlyPeriodNos(','async function scanSoccerTotalNos('],
  ['async function scanSoccerTotalNos(','async function scanVariablePlayerOvers(']]){
  const code=region(begin,end);
  assert.doesNotMatch(code,/if\(await noAskTimeout\.isRetired\(c,'no'\)&&\s*!await noAskTimeout\.claimRecovery\(c,'no'\)\)/,
   begin+' must not permanently discard already verified preflights');
  assert.match(code,/const \{orderbook_fp\}=await kalshi\(/,begin);
  assert.match(code,/noAskTimeout\.available\(\[c\],'no'\)/,begin);
  assert.ok(code.indexOf('const {orderbook_fp}=await kalshi(')<code.indexOf('const finalCheck='),begin);
 }
});

test('fast commanding lead cannot veto a freshly recovered YES ask solely because a previous 30s timer expired',()=>{
 const lead=region('async function watchLeadWindows(','async function watchReadyOverTickets(');
 assert.doesNotMatch(lead,/if\(await noAskTimeout\.isRetired\(\{market,game:first\},'yes'\)\)continue;/,
  'only a live unexecutable orderbook, not an old absent-ask timer, can block the recovered quote');
 assert.match(lead,/verifiedEntryQuote\(second,milestone,offered,scoreboardCache\)/);
});
