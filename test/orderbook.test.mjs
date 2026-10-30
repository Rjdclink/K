import test from 'node:test';
import assert from 'node:assert/strict';
import {yesDepthAtAsk,bestYesAsk,bestAsksForTickers} from '../src/orderbook.mjs';

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
