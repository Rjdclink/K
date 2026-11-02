import test from 'node:test';
import {assertExternalPurchase,rememberIndependentEntry} from '../src/entry_verification.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {takerFeeSpec,tradeFeeCents,manualPositionQuote,cashoutEstimate} from '../src/manual_position.mjs';
import {cashoutQuote} from '../src/sell.mjs';
const standard={type:'quadratic',multiplier:1};
const market={ticker:'OVER',event_ticker:'EVENT',status:'active',fractional_trading_enabled:true};
const position={ticker:'OVER',position_fp:'46.01',market_exposure_dollars:'41.50',fees_paid_dollars:'.04'};
const account={balance:10000,portfolio_value:4000};
const book={no_dollars:[['.10','1000']],yes_dollars:[['.72','1000']]};
test('manual quotes use published taker fees, including multiplier overrides, zero fees and unavailable schedules',()=>{
  assert.equal(tradeFeeCents([{price:.5,count:100}],standard),175);
  assert.equal(tradeFeeCents([{price:.5,count:100}],{...standard,multiplier:2}),350);
  assert.equal(takerFeeSpec({}, {}, {fee_type:'quadratic',fee_multiplier:1}).multiplier,1);
  assert.equal(takerFeeSpec({fee_multiplier_override:0},{fee_multiplier_override:2},{fee_type:'quadratic',fee_multiplier:1}).multiplier,0);
  assert.equal(takerFeeSpec({fee_waiver_expiration_time:'2099-01-01'},null,null).multiplier,0);
  assert.equal(takerFeeSpec({}, {}, {fee_type:'unknown',fee_multiplier:1}),null);
  assert.equal(takerFeeSpec({}, {}, {}),null);
});
test('cash-out value includes actual available levels, proportional position cost and estimated sale fees',()=>{
  const q=cashoutQuote(book,46.01),estimate=cashoutEstimate(position,q,standard);
  assert.equal(q.count,46.01);assert.equal(q.price,.72);
  assert.equal(estimate.net_cents,3247);assert.equal(estimate.profit_cents,-907);
  const levels={yes_dollars:[['.9','10'],['.8','20'],['.7','100']]};
  const partial=cashoutQuote(levels,40);
  assert.equal(partial.price,.7);assert.equal(partial.gross_cents,3200);assert.equal(partial.average_price,.8);
  const thin=cashoutQuote({yes_dollars:[['.9','5']]},40);
  assert.equal(thin.partial,true);assert.equal(thin.count,5);
  assert.equal(cashoutEstimate(position,q,null).net_cents,null,'unknown fees cannot produce a fabricated net value');
  assert.equal(cashoutEstimate({...position,fees_paid_dollars:null},q,standard).profit_cents,null);
});
test('manual additions honor chosen cash, shard cash, ask depth and whole-share constraints without automated allocation sizing',()=>{
  const q=manualPositionQuote(market,book,position,account,1000,10000,standard);
  assert.ok(q.count>0);assert.ok(q.max_cost_cents<=1000);assert.equal(q.price,.9);
  const cash=manualPositionQuote(market,book,position,{...account,balance:100},1000,10000,standard);
  assert.ok(cash.max_cost_cents<=100);
  const shard=manualPositionQuote(market,book,position,account,1000,200,standard);
  assert.ok(shard.max_cost_cents<=200);
  const whole=manualPositionQuote({...market,fractional_trading_enabled:false},book,position,account,1000,10000,standard);
  assert.ok(Number.isInteger(whole.count));
  for(const altered of [null,{...position,position_fp:'0'}])assert.equal(manualPositionQuote(market,book,altered,account,1000,10000,standard).count,undefined);
  assert.equal(manualPositionQuote({...market,status:'closed'},book,position,account,1000,10000,standard).count,undefined);
  assert.equal(manualPositionQuote(market,{},position,account,1000,10000,standard).count,undefined);
  assert.equal(manualPositionQuote(market,book,position,account,1000,10000,null).count,undefined);
});
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const id='00000000-0000-0000-0000-000000000001';
const body={ticker:'OVER',id,amount_cents:1000,price:.9,count:10,confirmed:true};
function harness({price=.9,old=null,expired=false,uncertain=false,result=null,verified=true}={}){
  const writes=[],sent=[];let released=false;
  const game={id:'game',verificationId:'fresh'};if(verified)rememberIndependentEntry(game,{...market,ticker:'OVER'},'fresh',Date.now());
  const entryVerifications=[{game,market:{...market,ticker:'OVER'}}];
  const client={query:async(sql,args)=>{
    writes.push([sql,args]);return sql.startsWith('SELECT * FROM manual_combo_buys')?{rows:old?[old]:[],rowCount:old?1:0}:{rows:[],rowCount:0};
  },release(){released=true}};
  const context=vm.createContext({console,URLSearchParams,manualPositionQuote,
    live:()=>true,ensureManualCombos:async()=>{},pool:{connect:async()=>client,query:async(sql,args)=>{writes.push([sql,args]);return {rows:[]}}},
    currentManualBuy:async()=>{
      assert.equal(released,true,'release the intent transaction before network reads');
      return {entryVerifications,position,account,market,book,fees:standard,quote:{price,count:9,max_cost_cents:900},checkedAt:Date.now()-(expired?30001:0)};
    },marketShard:()=>0,shardCash:()=>10000,transferPlan:()=>false,invalidateBalance:async()=>{},
    withEntryProfitFloor:async(options,send)=>{assert.equal(options.manual,true);return send()},
    kalshi:async(path,options)=>{
      if(path.startsWith('/portfolio/orders?'))return {orders:[{client_order_id:id,order_id:'actual',status:'executed',fill_count_fp:'9'}]};
      options.beforeDispatch();assertExternalPurchase(path,'POST',options.body,options.entryVerifications);options.onDispatch?.();sent.push(options.body);
      if(uncertain)throw Error('Network response lost');
      return result||{order_id:'actual',fill_count_fp:options.body.count,status:'executed'};
    },json:(body,status=200)=>({body,status})});
  vm.runInContext(source.slice(source.indexOf('async function lookupSubmittedOrder('),source.indexOf('async function syncTradeHistory(')),context);
  return {context,writes,sent};
}
test('manual purchase requires explicit confirmation, rechecks the ask, and bounds its submitted quantity',async()=>{
  const h=harness();
  assert.equal((await h.context.manualBuyPosition({...body,confirmed:false})).status,400);assert.equal(h.sent.length,0);
  const response=await h.context.manualBuyPosition(body);
  assert.equal(response.body.filled,9);assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].count,'9.00');assert.equal(h.sent[0].time_in_force,'fill_or_kill');
  const changed=harness({price:.91});assert.equal((await changed.context.manualBuyPosition(body)).status,409);assert.equal(changed.sent.length,0);
});
test('manual purchase retains the thirty-second quote limit and does not dispatch an expired quote',async()=>{
  const h=harness({expired:true});const response=await h.context.manualBuyPosition(body);
  assert.equal(response.status,409);assert.equal(h.sent.length,0);
  assert.ok(h.writes.some(([sql])=>sql.includes("SET status='unfilled'")));
});
test('uncertain manual purchases stay pending and reconcile by client ID without a duplicate buy',async()=>{
  const h=harness({uncertain:true});assert.equal((await h.context.manualBuyPosition(body)).status,502);
  assert.equal(h.sent.length,1);assert.equal(h.writes.some(([sql])=>sql.includes("SET status='unfilled'")),false);
  const recovery=harness({old:{id,ticker:'OVER',status:'pending',created_at:new Date()}});
  const response=await recovery.context.manualBuyPosition(body);assert.equal(response.body.filled,9);assert.equal(recovery.sent.length,0);
  const ambiguous=harness({result:{order_id:'accepted'}});
  assert.equal((await ambiguous.context.manualBuyPosition(body)).status,202);
  assert.ok(ambiguous.writes.some(([sql,args])=>sql.startsWith('UPDATE manual_combo_buys SET status=$2')&&args[1]==='pending'));
});
test('repeated completed purchase IDs return the original fill without another exchange write',async()=>{
  const h=harness({old:{id,ticker:'OVER',status:'complete',result:{fill_count_fp:'9'}}});
  assert.equal((await h.context.manualBuyPosition(body)).body.filled,9);assert.equal(h.sent.length,0);
  assert.equal(h.context.resolvedManualOrder({status:'executed'}),null,'missing fill data remains unknown');
});

test('manual dispatch without independent proof is rejected as a definite no-fill before any exchange write',async()=>{
  const h=harness({verified:false});const response=await h.context.manualBuyPosition(body);
  assert.equal(response.status,409);assert.equal(h.sent.length,0);
  assert.ok(h.writes.some(([sql])=>sql.includes("SET status='unfilled'")));
});
