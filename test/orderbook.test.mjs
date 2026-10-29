import test from 'node:test';
import assert from 'node:assert/strict';
import {yesDepthAtAsk,bestYesAsk} from '../src/orderbook.mjs';

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
