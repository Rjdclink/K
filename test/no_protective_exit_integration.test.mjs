import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {noNearLossScore,profitableNoReductionQuote} from '../src/no_protective_exit.mjs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const a=source.indexOf('async function exitAtRiskNos('),b=source.indexOf('async function exitComebacks(',a);
assert.ok(a>0&&b>a);
const code=source.slice(a,b);
const market={ticker:'KXEPLTOTAL-TEST-2',event_ticker:'KXEPLTOTAL-TEST',floor_strike:2.5,
 status:'active',rules_primary:'After 90 minutes and stoppage, excluding extra time'};
const game={id:'game-id',type:'soccer_match',sport:'Soccer',verifiedLive:true,
 scoreKnown:true,scoreConsistent:true,periodConsistent:true,observedAt:Date.now(),period:2,home:1,away:1};
const held={ticker:market.ticker,position_fp:-10,market_exposure_dollars:'6.00',fees_paid_dollars:'.10'};
function harness({noBid=.70,score=game,owned=true,position=held,priorPending=false}={}){
 const orders=[],events=[],queries=[];
 const context=vm.createContext({noNearLossScore,profitableNoReductionQuote,Map,JSON,
   Date,Number,Math,Promise,console,encodeURIComponent,
   pool:{query:async(sql,args=[])=>{
    queries.push(sql);
    if(sql.startsWith('SELECT DISTINCT ON (market_ticker)'))return {rows:owned?[{market_ticker:market.ticker,game_id:game.id}]:[]};
    if(sql.startsWith('INSERT INTO exit_attempts'))return {rowCount:1};
    if(sql.startsWith('SELECT to_regclass'))return {rows:[{name:null}]};
    return {rows:[],rowCount:1};
   }},
   kalshi:async(path,options)=>{
    if(options?.method==='POST'){orders.push(options.body);return {order_id:'no-close',fill_count_fp:'10'};}
    if(path.endsWith('/orderbook'))return {orderbook_fp:{no_dollars:[[String(noBid),'10']]}};
    if(path.startsWith('/events/'))return {event:{event_ticker:market.event_ticker}};
    if(path.startsWith('/markets/'))return {market};
    throw Error(path);
   },
   allOpenPositions:async()=>({market_positions:[position]}),
   feeReserve:()=>2,minimumCount:()=>.01,randomUUID:()=> 'fixed-id',
   reconcilePendingExit:async()=>!priorPending,
   recordExitFill:async(...args)=>events.push(['exit-ledger',args[2],args[3]]),
   invalidateBalance:async()=>events.push(['invalidate'])
 });
 vm.runInContext(code,context);
 return {run:()=>context.exitAtRiskNos([{milestone:{id:game.id},state:score}],
   new Map([[market.event_ticker,{event_ticker:market.event_ticker}]]),{market_positions:[position]}),
   orders,events,queries};
}
test('NO Over 2.5 at 1–1 immediately closes via strictly reduce-only YES bid with a profit',async()=>{
 const h=harness();
 assert.equal(await h.run(),1);
 assert.equal(h.orders.length,1);
 assert.equal(h.orders[0].side,'bid');
 assert.equal(h.orders[0].reduce_only,true);
 assert.equal(h.orders[0].time_in_force,'fill_or_kill');
 assert.equal(h.orders[0].price,'0.3000');
 assert.equal(h.orders[0].count,'10.00');
 assert.equal(h.events[0][0],'exit-ledger');
 assert.ok(h.queries.some(sql=>sql.includes('INSERT INTO exit_attempts')));
});
test('NO at risk remains held until an executable quote is profitable after fees',async()=>{
 for(const noBid of [.6,.58,.1,0]){
  const h=harness({noBid});
  assert.equal(await h.run(),0);
  assert.equal(h.orders.length,0,'unprofitable or missing liquidity never generates an order');
 }
});
test('no risk, untracked NO, stale score, pending exit, missing basis and positive YES prevent NO exit',async()=>{
 for(const settings of [
  {score:{...game,away:0}}, {owned:false},{score:{...game,verifiedLive:false}},
  {priorPending:true},{position:{...held,fees_paid_dollars:null}},
  {position:{...held,position_fp:10}}
 ]){
  const h=harness(settings);
  assert.equal(await h.run(),0,JSON.stringify(settings));
  assert.equal(h.orders.length,0);
 }
});
test('rapid NO watcher is connected separately from old YES profit exits',()=>{
 const fast=source.slice(source.indexOf('async function watchCorrectedOvers('),
   source.indexOf('async function watchLeadWindows('));
 assert.match(fast,/a.strategy IN \('over','no'\)/);
 assert.match(fast,/noNearLossScore/);
 assert.match(fast,/await exitAtRiskNos/);
 const normal=source.slice(source.indexOf('async function exitComebacks('),
   source.indexOf('async function watchCorrectedOvers('));
 assert.match(normal,/await exitAtRiskNos/);
});
