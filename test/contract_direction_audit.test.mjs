import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccountFill} from '../src/account_history.mjs';

const raw=(overrides={})=>({
  fill_id:'fixture-fill',order_id:'fixture-order',ticker:'FIXTURE',
  count_fp:'17.58',yes_price_dollars:'0.0700',no_price_dollars:'0.9300',
  fee_cost:'0.01',created_time:'2026-11-21T01:15:37.784Z',
  side:'no',action:'sell',outcome_side:'no',book_side:'ask',...overrides
});
test('historical basketball and soccer fills use canonical NO exposure, not deprecated SELL NO',()=>{
  for(const f of [raw(),raw({count_fp:'0.10',yes_price_dollars:'0.3400',no_price_dollars:'0.6600'})]){
    const actual=normalizeAccountFill(f);
    assert.equal(actual?.side,'no');
    assert.equal(actual?.action,'buy');
    assert.equal(actual?.price,Number(f.no_price_dollars));
  }
});
test('authoritative YES exposure overrides a misleading legacy NO side',()=>{
  const actual=normalizeAccountFill(raw({outcome_side:'yes',book_side:'bid'}));
  assert.equal(actual?.side,'yes');
  assert.equal(actual?.action,'buy');
  assert.equal(actual?.price,.07);
});
test('canonical fields alone suffice; conflicting or invalid canonical fields fail closed',()=>{
  assert.equal(normalizeAccountFill(raw({side:undefined,action:undefined}))?.side,'no');
  assert.equal(normalizeAccountFill(raw({outcome_side:undefined,side:undefined,action:undefined}))?.side,'no');
  assert.equal(normalizeAccountFill(raw({book_side:undefined,side:undefined,action:undefined}))?.side,'no');
  assert.equal(normalizeAccountFill(raw({book_side:'bid'})),null);
  assert.equal(normalizeAccountFill(raw({outcome_side:'unknown'})),null);
  assert.equal(normalizeAccountFill(raw({book_side:'unknown'})),null);
});
