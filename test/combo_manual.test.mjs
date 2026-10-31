import test from 'node:test';
import assert from 'node:assert/strict';
import {manualComboQuote} from '../src/combo_manual.mjs';

test('combo add-on requires a held market, live YES offer, cash and exposure room',()=>{
  const market={status:'active',fractional_trading_enabled:true};
  const book={no_dollars:[['0.2000','20.00']]};
  const position={position_fp:'2.00',market_exposure_dollars:'1.50',fees_paid_dollars:'0.01'};
  const account={balance:2000,portfolio_value:8000};
  const quote=manualComboQuote(market,book,position,account,false,1000);
  assert.equal(quote.price,.8);
  assert.ok(quote.count>0&&quote.max_cost_cents<=1000);
  assert.ok(manualComboQuote(market,book,position,account,false).max_cost_cents<=849,
    'a verified combo add-on stays within ten percent after held exposure and fees');
  assert.equal(manualComboQuote(market,{no_dollars:[]},position,account).reason,'No YES seller is available');
  assert.equal(manualComboQuote(market,book,{...position,position_fp:'0'},account).reason,'Combo position is no longer held');
  assert.equal(manualComboQuote({...market,status:'closed'},book,position,account).reason,'Combo market is closed');
  assert.equal(manualComboQuote(market,book,position,{...account,balance:0}).count,undefined);
  assert.ok(manualComboQuote(market,book,{...position,market_exposure_dollars:'19.00'},account,true).count===undefined);
});
