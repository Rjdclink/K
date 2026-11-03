import test from 'node:test';
import assert from 'node:assert/strict';
import {yesDepthAtAsk,bestYesAsk,bestAsksForTickers} from '../src/orderbook.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('YES purchase is limited to resting NO bids at or above the complementary price',()=>{
  const book={yes_dollars:[['0.80','100.00']],no_dollars:[['0.03','10.00'],['0.04','2.50'],['0.05','1.25']]};
  assert.equal(yesDepthAtAsk(book,'0.96','50.00'),3.75);
  assert.equal(yesDepthAtAsk(book,'0.95','50.00'),1.25);
  assert.equal(yesDepthAtAsk(book,'0.96','2.00'),2);
  assert.equal(yesDepthAtAsk({yes_dollars:book.yes_dollars},'0.96','50.00'),0);
});
test('a missing summary ask can be reconstructed only from actual NO bid depth',()=>{
  assert.deepEqual(bestYesAsk({no_dollars:[['0.04','2.50'],['0.05','1.25']]}),{price:.95,size:1.25});
  assert.equal(bestYesAsk({no_dollars:[['0.00','100.00']]}),null);
});
test('all missing asks are batched across games without a per-game or global cap',async()=>{
  const tickers=Array.from({length:105},(_,i)=>`GAME-${i}`),groups=[];
  const quotes=await bestAsksForTickers([...tickers,tickers[0]],async group=>{
    groups.push(group);
    return group.filter(t=>t!=='GAME-104').map(t=>({ticker:t,orderbook_fp:{no_dollars:[['0.06','1.50']]}}));
  },async ticker=>({ticker,orderbook_fp:{no_dollars:[['0.05','2.00']]}}));
  assert.deepEqual(groups.map(g=>g.length),[100,5]);
  assert.equal(quotes.size,105);
  assert.deepEqual(quotes.get('GAME-0'),{price:.94,size:1.5});
  assert.deepEqual(quotes.get('GAME-104'),{price:.95,size:2});
});
test('a failed batch retries every ticker individually, without inventing ask liquidity',async()=>{
  const checked=[];
  const quotes=await bestAsksForTickers(['A','B','C'],async()=>{throw Error('batch unavailable')},async ticker=>{
    checked.push(ticker);
    return {ticker,orderbook_fp:{no_dollars:ticker==='B'?[]:[['0.02','1.00']]}};
  });
  assert.deepEqual(checked,['A','B','C']);
  assert.equal(quotes.get('B'),null);
  assert.equal(quotes.get('C').price,.98);
});
test('incomplete books retry individually and unavailable books are not reported as empty',async()=>{
  const checked=[];
  const quotes=await bestAsksForTickers(['A','B','C'],async()=>[
    {ticker:'A',orderbook_fp:{}},{ticker:'B',orderbook_fp:{no_dollars:[]}}
  ],async ticker=>{checked.push(ticker);if(ticker==='C')throw Error('rate limited');
    return {ticker,orderbook_fp:{no_dollars:[null,['0.03','2.00']]}};
  });
  assert.deepEqual(checked,['A','C']);assert.equal(quotes.get('A').price,.97);
  assert.equal(quotes.get('B'),null);assert.equal(quotes.get('C'),undefined);
});
function quoteHarness(book){
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');let reads=0,probes=0;
  const context=vm.createContext({bestYesAsk,console,
    kalshi:async path=>{assert.equal(path,'/markets/EXACT/orderbook');reads++;return {orderbook_fp:book}},
    probeMissingAsks:async()=>{probes++;return new Map()}
  });
  vm.runInContext(source.slice(source.indexOf('const minimumCount='),source.indexOf('function contractCount(')),context);
  vm.runInContext(source.slice(source.indexOf('const signalKey='),source.indexOf('async function ensureShardFunding(')),context);
  return {context,get reads(){return reads},get probes(){return probes}};
}
test('execution uses the exact ticker live seller even when its advertised price or size is stale',async()=>{
  const h=quoteHarness({no_dollars:[['0.02','3.00']],yes_dollars:[['0.99','999.00']]});
  const quote=await h.context.executableQuote({ticker:'EXACT',yes_ask_dollars:'.97',yes_ask_size_fp:'0.00'});
  assert.equal(quote.yes_ask_dollars,'0.9800');assert.equal(quote.yes_ask_size_fp,'3.00');
  assert.equal(h.reads,1);
  const empty=quoteHarness({no_dollars:[],yes_dollars:[['0.99','999.00']]});
  assert.equal(await empty.context.executableQuote({ticker:'EXACT',yes_ask_dollars:'.97',yes_ask_size_fp:'2'}),null);
});
test('explicit fresh ask recovery bypasses the empty-book cooldown',async()=>{
  const h=quoteHarness({no_dollars:[['0.03','2.00']]}),market={ticker:'EXACT',yes_ask_dollars:'1',yes_ask_size_fp:'0'};
  await h.context.recoverSummaryAsk(market);assert.equal(h.reads,0);assert.equal(h.probes,1);
  const fresh=await h.context.recoverSummaryAsk(market,{fresh:true});
  assert.equal(h.reads,1);assert.equal(h.probes,1);assert.equal(fresh.yes_ask_dollars,'0.9700');
});
test('dashboard distinguishes a confirmed empty book from an unavailable or pending lookup',()=>{
  const h=quoteHarness(),candidate={signal:{strategy:'over'},market:{ticker:'EXACT',yes_ask_dollars:'1',yes_ask_size_fp:'0'}};
  const status=ask_probe=>h.context.signalExecution({...candidate,market:{...candidate.market,ask_probe}},new Set());
  assert.equal(status('empty'),'No ask liquidity');
  assert.equal(status('unavailable'),'Live ask check unavailable; retrying');
  assert.equal(status('pending'),'Live ask check pending');
});
