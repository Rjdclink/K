import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {singleSpendableCash} from '../src/combos.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const ranking=source.slice(source.indexOf('const estimate=c=>'),source.indexOf('// Each order has its own fraction'));
const candidate=(ticker,strategy,price)=>({market:{ticker,yes_ask_dollars:String(price)},signal:{strategy},event:{},state:{progress:.5}});
function ranked(balance){
 const opportunities=[candidate('OVER','over',.95),candidate('LEAD','lead',.80)];
 const context=vm.createContext({opportunities,balance,bankroll:10000,filled:new Set(),singleSpendableCash,
  feeReserve:()=>0,hasAsk:()=>true,signalKey:c=>c.market.ticker,executableCount:()=>5,
  estimatedCostCents:(count,price)=>count*price*100,netSettlementProfitCents:(count,price)=>count*(1-price)*100,
  playerOverSpec:()=>null,playerPropEarlyWindow:()=>false,tieRefundPreference:()=>false});
 vm.runInContext(ranking,context);return opportunities.map(c=>c.market.ticker);
}
test('scarce cash favors the larger net profit; ample cash retains entry priority',()=>{
 assert.deepEqual(ranked(1700),['OVER','LEAD']);
 assert.deepEqual(ranked(1500),['LEAD','OVER']);
});
test('cash-limited combo quotes favor net profit over leg count',()=>{
 const section=source.slice(source.indexOf('const offerCashLimited='),source.indexOf('for(const {q,terms,plan,fees} of offers)'));
 const offers=[{terms:{debitCents:600,profitCents:25},plan:{legs:[1,2,3]}},{terms:{debitCents:600,profitCents:80},plan:{legs:[1,2]}}];
 const order=cash=>{const context=vm.createContext({offers:[...offers],account:{balance:cash},newTicker:'X'});vm.runInContext(section,context);return context.offers.map(x=>x.terms.profitCents)};
 assert.deepEqual(order(1300),[25,80]);assert.deepEqual(order(1000),[80,25]);
});
