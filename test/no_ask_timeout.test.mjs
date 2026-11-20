import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoAskTimeout,NO_ASK_GRACE_MS,NO_ASK_RETIRED} from '../src/no_ask_timeout.mjs';

function database(){
 let now=0,create=0,read=0,writes=0;
 const records=new Map(),key=x=>[x.ticker||x.market_ticker,x.game_id,x.side].join(':');
 const query=async(sql,args=[])=>{
  if(sql.startsWith('CREATE TABLE')){create++;return {rows:[]}};
  const [raw,side]=args;const items=JSON.parse(raw);
  if(sql.startsWith('SELECT')){read++;return {rows:items.filter(x=>{
   const t=records.get(key({...x,side}));return t!==undefined&&now-t>=30_000;
  }).map(x=>({market_ticker:x.ticker,game_id:x.game_id}))};}
  if(sql.startsWith('INSERT')){writes++;return {rows:items.map(x=>{
    const id=key({...x,side});if(!records.has(id))records.set(id,now);
    const elapsed=Math.max(0,now-records.get(id));
    return {market_ticker:x.ticker,game_id:x.game_id,retired:elapsed>=30_000,
      elapsed_ms:Math.min(30_000,elapsed)};
  })};}
  if(sql.startsWith('DELETE')){writes++;for(const x of items){const id=key({...x,side});
    if(records.has(id)&&now-records.get(id)<30_000)records.delete(id);
  }return {rows:[]};}
  throw Error('Unexpected SQL '+sql);
 };
 return {query,advance:ms=>{now+=ms},get now(){return now},get create(){return create},
  get read(){return read},get writes(){return writes},records};
}
const market=(ticker='SOCCER-OVER',id='fixture')=>({market:{ticker},state:{id}});
test('one candidate receives exactly thirty real seconds and is then persistently skipped',async()=>{
 const db=database(),a=createNoAskTimeout(db.query),b=createNoAskTimeout(db.query),m=market();
 assert.equal(NO_ASK_GRACE_MS,30_000);
 assert.match(NO_ASK_RETIRED,/30 seconds/);
 assert.equal((await a.observeMissing(m,'yes')).retired,false);
 db.advance(20_000);
 assert.equal((await b.observeMissing(m,'yes')).retired,false);
 assert.equal((await a.retired([m],'yes')).size,0);
 db.advance(9_999);
 assert.equal((await a.observeMissing(m,'yes')).retired,false);
 db.advance(1);
 assert.equal((await b.observeMissing(m,'yes')).retired,true);
 assert.equal(await a.isRetired(m,'yes'),true);
 db.advance(86400_000);
 assert.equal(await b.isRetired(m,'yes'),true,'no 10-minute cooldown or daily automatic reactivation');
 assert.equal(db.records.size,1,'repeat checks must never refresh initial absence');
 assert.equal(db.create,2,'one create per runtime instance');
});
test('YES and NO liquidity are different sides and each independent game retains a separate timer',async()=>{
 const db=database(),gate=createNoAskTimeout(db.query),soccer=market('TOTAL','game-one');
 await gate.missing([soccer],'yes');db.advance(30_000);
 assert.equal(await gate.isRetired(soccer,'yes'),true);
 assert.equal(await gate.isRetired(soccer,'no'),false,'YES absence must never suppress a NO order');
 assert.equal((await gate.observeMissing(soccer,'no')).retired,false);
 assert.equal(await gate.isRetired(market('TOTAL','another-game'),'yes'),false);
 const another=market('TOTAL','another-game');
 assert.equal((await gate.observeMissing(another,'yes')).retired,false);
 assert.equal((await gate.retired([soccer,another],'yes')).size,1);
});
test('a quote arriving before thirty seconds cancels only that candidate timeout',async()=>{
 const db=database(),gate=createNoAskTimeout(db.query);
 const a=market('A'),b=market('B');
 await gate.missing([a,b],'yes');db.advance(29_000);
 await gate.available([a],'yes');db.advance(2_000);
 assert.equal(await gate.isRetired(a,'yes'),false);
 assert.equal(await gate.isRetired(b,'yes'),true);
 assert.equal((await gate.observeMissing(a,'yes')).retired,false,'new empty period begins after recovery');
 db.advance(30_000);
 await gate.available([a,b],'yes');
 assert.equal(await gate.isRetired(a,'yes'),true,'quote after the deadline cannot revive a retired trade');
 assert.equal(await gate.isRetired(b,'yes'),true);
});
test('dedupe multi-scan candidates and ignore invalid game IDs and sides',async()=>{
 const db=database(),gate=createNoAskTimeout(db.query),m=market();
 const one=await gate.missing([m,m,{ticker:'BAD'},m],'no');
 assert.equal(one.size,1);
 assert.equal((await gate.retired([m,m,{ticker:'BAD'}],'no')).size,0);
 assert.equal((await gate.missing([m],'invalid')).size,0);
 assert.equal(db.records.size,1);
});