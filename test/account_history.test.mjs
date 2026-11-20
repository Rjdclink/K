import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccountFill,realizedAccountMarket,summarizeAccountMarkets} from '../src/account_history.mjs';

const at='2026-11-19T21:00:00.000Z',settled='2026-11-20T01:00:00.000Z';
const fill=(id,action='buy',side='yes',count='10.00',price='0.4000',fee='0.1000',ticker='KXTEST-A')=>({
  fill_id:id,order_id:'order-'+id,ticker,action,side,count_fp:count,
  yes_price_dollars:side==='yes'?price:String(1-Number(price)),
  no_price_dollars:side==='no'?price:String(1-Number(price)),fee_cost:fee,created_time:at
});
const settlement=(ticker='KXTEST-A',revenue=1000,result='yes')=>({
 ticker,revenue,market_result:result,settled_time:settled
});
test('manual YES winner derives exact cost, exchange payout, and fees from actual account fills',()=>{
 const result=realizedAccountMarket([normalizeAccountFill(fill('manual'))],settlement());
 assert.equal(result?.profitCents,590);
 assert.equal(result?.occurredAt,settled);
 assert.equal(result?.outcome,'settled');
});
test('manual NO win/loss uses NO purchase price and authoritative settlement revenue',()=>{
 const bought=normalizeAccountFill(fill('no','buy','no','10','0.3000','0.1000'));
 assert.equal(realizedAccountMarket([bought],settlement('KXTEST-A',1000,'no'))?.profitCents,690);
 assert.equal(realizedAccountMarket([bought],settlement('KXTEST-A',0,'yes'))?.profitCents,-310);
});
test('partial sale fees and remaining settlement payout are included without double counting',()=>{
 const buys=normalizeAccountFill(fill('buy','buy','yes','10','0.40','0.10'));
 const sells=normalizeAccountFill(fill('sell','sell','yes','4','0.70','0.05'));
 const result=realizedAccountMarket([buys,sells],settlement('KXTEST-A',600));
 assert.equal(result?.profitCents,465,'6 unsettled shares pay $6; $2.80 sale proceeds; $4 buy cost; $0.15 fees');
});
test('a fully sold manual contract is realized even before settlement but an open contract is not',()=>{
 const buy=normalizeAccountFill(fill('b','buy','yes','10','0.45','0.10'));
 const sold=normalizeAccountFill(fill('s','sell','yes','10','0.65','0.10'));
 const result=realizedAccountMarket([buy,sold],null);
 assert.equal(result?.profitCents,180);
 assert.equal(result?.outcome,'closed');
 assert.equal(realizedAccountMarket([buy],null),null,'open positions must never be called realized wins');
});
test('unknown action, missing fees, invalid quantity and missing fill ID fail closed rather than invent a profit',()=>{
 for(const bad of [
  {...fill('a'),action:undefined},{...fill('b'),fee_cost:undefined},
  {...fill('c'),count_fp:'0'}, {...fill('d'),fill_id:undefined},
  {...fill('e'),yes_price_dollars:undefined,no_price_dollars:undefined}
 ])assert.equal(normalizeAccountFill(bad),null);
});
test('a canonical NO-side offset against a YES position cannot be misclassified as a new losing purchase',()=>{
 const yes=normalizeAccountFill(fill('yes-open','buy','yes','10','0.40','0.10'));
 const offset=normalizeAccountFill(fill('no-offset','buy','no','10','0.30','0.10'));
 assert.equal(realizedAccountMarket([yes,offset],settlement('KXTEST-A',0,'yes')),null);
 const result=summarizeAccountMarkets([yes,offset],[settlement('KXTEST-A',0,'yes')]);
 assert.equal(result.rows.length,0);
 assert.deepEqual(result.unresolved,['KXTEST-A']);
});
test('missing exchange timestamp and conflicted settlement cannot manufacture a history win',()=>{
 const a=fill('m');
 delete a.created_time;
 assert.equal(normalizeAccountFill(a),null);
 const valid=normalizeAccountFill(fill('good'));
 const bad={...settlement(),revenue:NaN};
 const {rows,unresolved}=summarizeAccountMarkets([valid],[bad]);
 assert.equal(rows.length,0);
 assert.deepEqual(unresolved,['KXTEST-A']);
});
test('every market gets one realized row, each exchange fill counted once',()=>{
 const a=normalizeAccountFill(fill('manual'));
 const b=normalizeAccountFill(fill('manual'));
 const c=normalizeAccountFill(fill('manual-other','buy','no','5','0.20','0.02','KXOTHER-B'));
 const {rows,unresolved}=summarizeAccountMarkets([a,b,c],[settlement(),settlement('KXOTHER-B',0,'yes')]);
 assert.equal(rows.length,2);
 assert.equal(rows.find(x=>x.ticker==='KXTEST-A')?.profitCents,590);
 assert.equal(rows.find(x=>x.ticker==='KXOTHER-B')?.profitCents,-102);
 assert.equal(unresolved.length,0);
});
test('incomplete or malformed market cannot replace known history with a false total',()=>{
 const a=normalizeAccountFill(fill('ok'));
 const {rows,unresolved}=summarizeAccountMarkets([a,{...a,fillId:'unclassifiable',price:NaN}],[settlement()]);
 assert.equal(rows.length,0);
 assert.deepEqual(unresolved,['KXTEST-A']);
});
