import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const begin=source.indexOf('async function confirmedIndependentOver(');
const end=source.indexOf('async function preflightNearOver(',begin);
assert.ok(begin>=0&&end>begin);
const text=source.slice(begin,end);
function harness({quoted=true,depth=true}={}){
 let externals=0,quotes=0,missing=0,bookChecks=0;
 const market={ticker:'TEST-YES',status:'active',event_ticker:'TEST'};
 const first={id:'game',sport:'CFB',scoreKnown:true,verifiedLive:true,period:4};
 const context=vm.createContext({
  externalSportFeeds:()=>true,
  externallyScoredOverState:async game=>{externals++;return {...game,externalProven:true}},
  noAskTimeout:{isRetired:async()=>false,claimRecovery:async()=>false,
   observeMissing:async()=>{missing++},available:async()=>{}},
  ensureOverWindows:async()=>{},
  overCushion:()=>null,
  pool:{query:async()=>({rows:[],rowCount:0})},
  overContractKey:()=> 'same-contract',
  kalshi:async()=>{quotes++;return {market}},
  recoverSummaryAsk:async()=>quoted?{...market,yes_ask_dollars:'0.70',yes_ask_size_fp:'10'}:market,
  hasAsk:()=>quoted,
  executableQuote:async row=>{bookChecks++;return depth?row:null}
 });
 vm.runInContext(text,context);
 return {run:()=>context.confirmedIndependentOver(first,{id:'game'},market),
  get externals(){return externals},get quotes(){return quotes},
  get missing(){return missing},get bookChecks(){return bookChecks}};
}

test('OVER never requests ESPN before confirming an actual YES seller, even when an indicative ask is present',async()=>{
 const quotedButEmpty=harness({quoted:true,depth:false});
 assert.equal(await quotedButEmpty.run(),null);
 assert.equal(quotedButEmpty.externals,0);
 assert.equal(quotedButEmpty.bookChecks,1,'actual orderbook depth must be probed');
 assert.equal(quotedButEmpty.missing,1,'missing executable seller still starts the 30-second absence timer');
 const noQuote=harness({quoted:false});
 assert.equal(await noQuote.run(),null);
 assert.equal(noQuote.externals,0);
 assert.equal(noQuote.missing,1);
});

test('OVER still performs independent ESPN confirmation once executable book depth exists',async()=>{
 const h=harness({quoted:true,depth:true});
 assert.equal(await h.run(),null,'the separate cushion gate must still reject this test fixture');
 assert.equal(h.externals,1,'independent ESPN check occurs after the executable seller is confirmed');
 assert.equal(h.bookChecks,1);
});

test('OVER preserves authoritative independent scoring rather than vetoing using Kalshi score before proof',()=>{
 const p=text.indexOf('const independent=await externallyScoredOverState(first');
 const q=text.indexOf('const seller=quoted&&hasAsk(quoted)?await executableQuote(quoted):null;');
 const cushion=text.indexOf('if(overCushion(first,market)===null)');
 assert.ok(q>=0&&p>q&&cushion>p,
  'verify executable YES liquidity first, independently source scores second, then evaluate the cushion');
});