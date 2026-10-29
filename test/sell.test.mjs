import test from 'node:test';
import assert from 'node:assert/strict';
import {sellQuote} from '../src/sell.mjs';
test('sale uses the best YES bid and available depth, without overselling',()=>{
 assert.deepEqual(sellQuote({yes_dollars:[['.95','12'],['.97','3']]},10),{price:.97,count:3});
 assert.deepEqual(sellQuote({yes_dollars:[['.97','12']]},2.35),{price:.97,count:2.35});
 assert.equal(sellQuote({no_dollars:[['.97','12']]},10),null);
 assert.equal(sellQuote({yes_dollars:[['.97','12']]},0),null);
});
