import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {overRetryExplanation} from '../src/over_retry_status.mjs';
import {allowsNewEntry} from '../src/entry_exclusions.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');

test('a visible ask with missing independent fixture has an actionable explanation, not generic no eligible order',()=>{
 const reason=overRetryExplanation({stage:'score_verification',outcome:'skipped',
   detail:'No exact matching fixture on the ESPN soccer scoreboard'});
 assert.equal(reason,'No exact matching fixture on the ESPN soccer scoreboard');
 assert.doesNotMatch(reason,/no eligible order|rechecked/i);
 assert.match(overRetryExplanation({stage:'live_contract_and_orderbook'}),/executable YES seller|orderbook/i);
 assert.match(overRetryExplanation({stage:'score_and_cash_recheck'}),/cash|profit/i);
 assert.match(overRetryExplanation({stage:'fresh_score'}),/fresh/i);
 assert.equal(overRetryExplanation({outcome:'filled',stage:'submission'}),'Order submitted');
});

test('fast OVER retry returns the exact reason for the individual ticker when a fresh soccer score is not independently confirmed',async()=>{
 const start=source.indexOf('async function watchReadyOverTickets(');
 const end=source.indexOf('// Retry ONLY the requested game and contract lines',start);
 assert.ok(start>0&&end>start);
 const milestone={id:'game',type:'soccer_match',title:'Two teams',details:{league:'Soccer'}};
 const ticker='KXSOCCERTOTAL-TEST-3',market={ticker,event_ticker:'KXSOCCERTOTAL-TEST',status:'active'};
 const decisions=[];
 const ctx=vm.createContext({
  Date,Set,Map,Promise,Math,Number,JSON,console,overRetryExplanation,allowsNewEntry,
  live:()=>true,ensureLeadWatch:async()=>{},
  pool:{query:async sql=>sql.includes('SELECT w.milestone')?
    {rows:[{milestone,live_score:{_observed_at:new Date().toISOString()},signals:[{strategy:'over',ticker}]}]}:
    sql.includes('SELECT market_ticker,last_seen')?{rows:[]}:Promise.reject(Error('Unexpected SQL'))},
  supportedScannerSport:()=>true,
  readyOverTickets:()=>[{milestone,signal:{ticker}}],
  prioritizeReadyOverTickets:rows=>rows,
  noAskTimeout:{isRetired:async()=>false},
  liveMilestone:async()=>({_observed_at:new Date().toISOString()}),
  gameState:()=>({id:'game',type:'soccer_match',sport:'Soccer',verifiedLive:true,scoreKnown:true}),
  eligibleForMarkets:()=>true,
  entryEventTickers:()=>['KXSOCCERTOTAL-TEST'],
  kalshi:async()=>({market}),
  linkedEventTickers:()=>['KXSOCCERTOTAL-TEST'],
  marketMap:async()=>new Map([['KXSOCCERTOTAL-TEST',{category:'Sports',markets:[market]}]]),
  confirmedIndependentOver:async state=>{state.verificationIssue='No exact matching fixture on ESPN';return null;},
  recordDecision:async d=>{decisions.push(d)}
 });
 vm.runInContext(source.slice(start,end),ctx);
 const results=await ctx.watchReadyOverTickets(Date.now()+15000,{onlyTickers:new Set([ticker]),once:true});
 assert.equal(results?.get(ticker),'No exact matching fixture on ESPN');
 assert.equal(decisions.length,1);
 assert.equal(decisions[0].stage,'score_verification');
 assert.equal(decisions[0].detail,'No exact matching fixture on ESPN');
});

test('the recheck completion uses each ticker-specific rejection reason instead of a blanket success-sounding check label',()=>{
 const start=source.indexOf('async function watchEntryRechecks(');
 const end=source.indexOf('async function nws(',start);
 const worker=source.slice(start,end);
 assert.ok(worker.includes('overRetryReasons')&&worker.includes('candidate.market_ticker'),
   'must attach a specific verification result to each rejected over contract');
 assert.ok(!worker.includes("reason='OVER proof, executable ask and profit rechecked'"),
   'the historical canned reason is not an explanation of why an order failed');
 assert.ok(worker.includes('candidateReason'),'retry table and dashboard must use the same reason');
 assert.match(worker,/Two prioritized entry rechecks completed;/,'dashboard can identify completed checks');
 const ui=readFileSync(new URL('../src/ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/quoted ask/i,'displayed ask must be labelled a quote, not assured executable depth');
 assert.match(ui,/displayed.*(?:orderbook|executable)/i,'visible shares are not guaranteed executable');
});