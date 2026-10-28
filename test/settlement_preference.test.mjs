import test from 'node:test';
import assert from 'node:assert/strict';
import {tieRefundPreference} from '../src/settlement_preference.mjs';

test('a 50 cent draw resolution is not a refund on a high priced YES',()=>{
  assert.equal(tieRefundPreference({rules_primary:'If the fight ends in a draw, both markets resolve to $0.50.'}),false);
  assert.equal(tieRefundPreference({rules_primary:'If the match ends in a tie, all markets resolve 50/50.'}),false);
  assert.equal(tieRefundPreference({rules_primary:'If the event is cancelled, the fair price will be paid.'}),false);
});

test('prefer only an explicit tie return of cost and fees',()=>{
  assert.equal(tieRefundPreference({rules_secondary:'If the game ends in a tie, the purchase price and all fees will be refunded.'}),true);
  assert.equal(tieRefundPreference({rules_secondary:'If the game ends in a tie, the purchase price will be refunded.'}),false);
  assert.equal(tieRefundPreference({rules_secondary:'If the game is cancelled, the purchase price and all fees will be refunded. A tie resolves to $0.50.'}),false);
});
