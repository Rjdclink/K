import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumProfitCents,profitableCount,netSettlementProfitCents} from '../src/strategy.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// 5%-capped NO includes professional/college basketball full-game and quarter,
// NHL period and game totals, and soccer half and game totals.
const fivePctSports=[
 {sport:'NBA',type:'basketball_game'},
 {sport:'WNBA',type:'basketball_game'},
 {sport:'NCAAB',type:'basketball_game'},
 {sport:'NCAAW',type:'basketball_game'},
 {sport:'NHL',type:'hockey_match'},
 {sport:'Soccer',type:'soccer_match'}
];
test('five-percent NO strategy requires only strictly positive whole-order net cents across bankroll sizes and filled-order tiers',()=>{
 for(const game of fivePctSports)for(const bankroll of [50,9999,10000,20000,100000])
  for(const filledOrders of [0,10,15,20,100]){
   assert.equal(minimumProfitCents('no',bankroll,game.type,120,filledOrders,
     {game,fraction:.05}),1,game.sport+' '+bankroll+' '+filledOrders);
  }
});
test('one net cent after estimated fees qualifies, but zero or negative does not',()=>{
 const game=fivePctSports[0];
 const prices=[.01,.05,.1,.2,.5,.75,.9,.95,.98,.99];
 const example=prices.flatMap(price=>Array.from({length:200},(_,i)=>{
   const count=(i+1)/100,profit=netSettlementProfitCents(count,price,2);
   return {price,count,profit};
 })).find(x=>x.profit===1);
 assert.ok(example,'a quantity-price combination yielding exactly one net cent exists');
 assert.equal(profitableCount(example.count,example.price,2,'no',20000,game.type,120,
   {game,fraction:.05}),example.count);
 const zero=prices.flatMap(price=>Array.from({length:200},(_,i)=>{
   const count=(i+1)/100;return {price,count,profit:netSettlementProfitCents(count,price,2)};
 })).find(x=>x.profit===0);
 assert.ok(zero,'zero-net example exists');
 assert.equal(profitableCount(zero.count,zero.price,2,'no',20000,game.type,120,
   {game,fraction:.05}),0);
});
test('ten-percent football, thirty-percent yardage NO, and other strategy floors remain unchanged',()=>{
 assert.equal(minimumProfitCents('no',20000,'football_game',240,20,
   {game:{sport:'NFL',type:'football_game'},fraction:.10}),200);
 assert.equal(minimumProfitCents('no',20000,'football_game',240,20,
   {game:{sport:'CFB',type:'football_game'},fraction:.10}),200);
 assert.equal(minimumProfitCents('no',20000,'football_game',240,20,
   {game:{sport:'NFL',type:'football_game'},fraction:.30}),200);
 assert.equal(minimumProfitCents('over',5000,'',NaN,15),35);
 assert.equal(minimumProfitCents('lead',5000,'',NaN,20),50);
 assert.equal(minimumProfitCents('weather',5000),30);
});
test('filled-order final gate passes the same five-percent fraction into minimum floor and does not change NO exposure',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function withEntryProfitFloor('),
  source.indexOf('async function ensureStaleReviewTable('));
 const checks=[];
 const query=async sql=>{
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{acquired:true}]};
  if(sql.includes('FROM trade_attempts'))return {rows:[]};
  throw Error(sql);
 };
 const context=vm.createContext({
  pool:{connect:async()=>({query,release:()=>{}})},
  ensureManualCombos:async()=>{},
  allOpenPositions:async()=>({market_positions:[]}),
  filledOrderGateCount:()=>0,
  minimumProfitCents:(strategy,bankroll,type,seconds,orders,entry)=>{
   checks.push({strategy,fraction:entry?.fraction});
   return minimumProfitCents(strategy,bankroll,type,seconds,orders,entry);
  },
  netSettlementProfitCents,Promise,setTimeout,Date,Number,Math
 });
 vm.runInContext(code,context);
 let sent=0;
 const run=async fraction=>context.withEntryProfitFloor({
  ticker:'KXNBA-TOTAL',strategy:'no',fraction,count:exampleCount,price:.5,fees:2,bankroll:20000,
  game:{sport:'NBA',type:'basketball_game'},market:{ticker:'KXNBA-TOTAL'}
 },async()=>{sent++;return {ok:true};});
 // Two contracts at 50 cents return a positive net result, well below the old $2 floor.
 const exampleCount=2;
 assert.ok(netSettlementProfitCents(exampleCount,.5,2)>0);
 await run(.05);
 assert.equal(sent,1);
 assert.equal(checks[0].fraction,.05);
});
