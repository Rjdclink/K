import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertScannerTradeDisabled} from '../src/scanner_trade_gate.mjs';

test('both Mentions sides and Crypto hit orders fail before Kalshi dispatch',()=>{
  for(const type of ['mentions','crypto']){
    const entries=[{game:{type},market:{ticker:'SCANNER-MARKET'}}];
    assert.throws(()=>assertScannerTradeDisabled('/portfolio/events/orders','POST',entries),
      {code:'LOCAL_SCANNER_TRADING_DISABLED'});
    assert.throws(()=>assertScannerTradeDisabled('/portfolio/orders/batched','POST',entries),
      {code:'LOCAL_SCANNER_TRADING_DISABLED'});
  }
});

test('the scanner gate preserves sports orders and read-only calls',()=>{
  assert.doesNotThrow(()=>assertScannerTradeDisabled('/portfolio/events/orders','POST',
    [{game:{type:'basketball_game',sport:'NBA'}}]));
  assert.doesNotThrow(()=>assertScannerTradeDisabled('/markets/EXAMPLE','GET',
    [{game:{type:'mentions'}}]));
});

test('both scanner callbacks exit before reserving and the common order gateway enforces the gate',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  for(const [name,flag] of [['Mention','MENTIONS_TRADING_ENABLED'],['Crypto','CRYPTO_TRADING_ENABLED']]){
    assert.match(source,new RegExp(`const ${flag}=false;`));
    assert.match(source,new RegExp(`async function executeVerified${name}\\(item\\)\\{[\\s\\S]{0,160}if\\(!${flag}\\)return 'trading_disabled'`));
    assert.match(source,new RegExp(`onVerified:executeVerified${name}`));
  }
  assert.match(source,/assertScannerTradeDisabled\(path,method,opts\.entryVerifications\)/);
});
