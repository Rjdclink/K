import test from 'node:test';
import assert from 'node:assert/strict';
import {cryptoHitContract,qualifyingCryptoMinute,pairedCryptoProof,tripleCryptoProof} from '../src/crypto_hit.mjs';
import {scanCryptoHits} from '../src/crypto_scanner.mjs';

const start=Date.parse('2026-11-04T12:00:00Z'),minute=start+60_000;
const series={category:'Crypto',settlement_sources:[{name:'CF Benchmarks'}]};
const event={event_ticker:'KXBTCABOVEBY-TEST'};
const market={ticker:'KXBTCABOVEBY-TEST-YES',event_ticker:event.event_ticker,status:'active',
  open_time:new Date(start).toISOString(),expected_expiration_time:new Date(start+3600_000).toISOString(),
  close_time:new Date(start+3600_000).toISOString(),floor_strike:80000,yes_sub_title:'Above $80,000',
  rules_primary:'If a qualifying one-minute average of the CF Bitcoin Real-Time Index (BRTI) is above $80,000 after issuance at Nov 4, 2026 at 7:00 AM EST and before Nov 4, 2026 at 8:00 AM EST, then the market resolves to Yes.',
  rules_secondary:'The source is CF Benchmarks. Each minute after issuance and before the deadline is evaluated separately: discard the highest 20% and lowest 20% of BRTI observations in that minute and average the remaining 60%. The qualifying average must be strictly greater than the threshold.'};
const ticks=(price=80001)=>({data:{payload:Array.from({length:60},(_,i)=>({time:minute+i*1000,value:String(price)}))}});

test('admits a CF one-minute hit but rejects a future-time price and mismatched strike',()=>{
  const contract=cryptoHitContract(event,market,series);
  assert.equal(contract.index,'BRTI');assert.equal(contract.direction,'above');
  assert.equal(cryptoHitContract(event,{...market,floor_strike:80001},series),null);
  assert.equal(cryptoHitContract(event,{...market,rules_primary:'If Bitcoin is above $80,000 at 8 AM, then the market resolves to Yes.'},series),null);
});
test('requires a complete finalized minute and strict CF trimmed average',()=>{
  const contract=cryptoHitContract(event,market,series),now=minute+61_000;
  assert.equal(qualifyingCryptoMinute(contract,ticks(),minute+59_000),null);
  assert.equal(qualifyingCryptoMinute(contract,{data:{payload:ticks().data.payload.slice(1)}},now),null);
  assert.equal(qualifyingCryptoMinute(contract,ticks(80000),now),null);
  assert.equal(qualifyingCryptoMinute(contract,ticks(80001),now)?.average,80001);
  assert.equal(qualifyingCryptoMinute(contract,{data:{payload:[...ticks().data.payload,{time:minute,value:'80001'}]}},now),null);
  assert.equal(qualifyingCryptoMinute(contract,{data:{payload:ticks().data.payload.map((x,i)=>i===1?{...x,repeatOfPreviousValue:true}:x)}},now),null);
});
test('three separate reads agree after 15 then 20 seconds; changed data resets proof',()=>{
  const contract=cryptoHitContract(event,market,series),first=qualifyingCryptoMinute(contract,ticks(),minute+60_000);
  const second=qualifyingCryptoMinute(contract,ticks(),first.checkedAt+15_000);
  const third=qualifyingCryptoMinute(contract,ticks(),second.checkedAt+20_000);
  assert.equal(pairedCryptoProof(first,second,second.checkedAt),true);
  assert.equal(tripleCryptoProof(first,second,third,third.checkedAt),true);
  assert.equal(tripleCryptoProof(first,second,{...third,checkedAt:second.checkedAt+19_999}),false);
  assert.equal(tripleCryptoProof(first,second,{...third,fingerprint:'amended'}),false);
});
test('a newer qualifying minute cannot reset an in-progress three-read proof',()=>{
  const contract=cryptoHitContract(event,market,series);
  const newer=ticks().data.payload.map(point=>({...point,time:point.time+60_000}));
  const feed={data:{payload:[...ticks().data.payload,...newer]}};
  const first=qualifyingCryptoMinute(contract,ticks(),minute+60_000);
  const second=qualifyingCryptoMinute(contract,feed,first.checkedAt+61_000,first.minute);
  assert.equal(second.minute,first.minute);
  assert.equal(qualifyingCryptoMinute(contract,feed,first.checkedAt+61_000).minute,minute+60_000);
});
test('scanner starts proof, waits 15 then 20 seconds and does not resurvey on fast checks',async()=>{
  let at=minute+60_000,window=null,tracked,orders=0,calls=[];
  const options={now:()=>at,kalshi:async path=>{calls.push(path);
    return path.startsWith('/series?')?{series:[{...series,title:'Bitcoin above by date',ticker:'KXBTCABOVEBY'}]}:
      {events:[{...event,series_ticker:'KXBTCABOVEBY',markets:[market]}]};},
    readIndex:async()=>ticks(),getWindow:async()=>window,
    saveWindow:async(_,value)=>{window=value},onVerified:async()=>{orders++}};
  const first=await scanCryptoHits({...options,onCandidates:items=>tracked=items});
  assert.equal(first.firstChecks,1);assert.equal(orders,0);
  at+=14_999;assert.equal((await scanCryptoHits({...options,tracked})).secondChecks,0);
  at++;assert.equal((await scanCryptoHits({...options,tracked})).secondChecks,1);
  at+=19_999;assert.equal((await scanCryptoHits({...options,tracked})).thirdChecks,0);
  at++;assert.equal((await scanCryptoHits({...options,tracked})).thirdChecks,1);
  assert.equal(orders,1);assert.equal(calls.filter(x=>x.startsWith('/series?')).length,1);
});
test('a failed CF read clears an in-progress sequence and never starts the third check',async()=>{
  let at=minute+60_000,window=null,tracked,feed=ticks(),orders=0;
  const options={now:()=>at,kalshi:async path=>path.startsWith('/series?')?
    {series:[{...series,title:'Bitcoin above by date',ticker:'KXBTCABOVEBY'}]}:
    {events:[{...event,series_ticker:'KXBTCABOVEBY',markets:[market]}]},
    readIndex:async()=>feed,getWindow:async()=>window,
    saveWindow:async(_,value)=>{window=value},clearWindow:async()=>{window=null},
    onVerified:async()=>{orders++}};
  await scanCryptoHits({...options,onCandidates:items=>tracked=items});
  at+=15_000;feed={data:{payload:[]}};
  const failed=await scanCryptoHits({...options,tracked});
  assert.equal(failed.secondChecks,0);assert.equal(window,null);
  at+=20_000;feed=ticks();
  const restarted=await scanCryptoHits({...options,tracked});
  assert.equal(restarted.firstChecks,1);assert.equal(orders,0);
});
