import {createHash} from 'node:crypto';

export const CRYPTO_PROOF_DELAY_MS=15_000;
const normalized=value=>String(value||'').replace(/\s+/g,' ').trim();

// Admit only contracts whose own rules describe a qualifying minute on the
// named CF index. Price-at-a-future-time and two-threshold races fail closed.
export function cryptoHitContract(event,market,series){
  if(series?.category!=='Crypto'||!series.settlement_sources?.some(source=>source.name==='CF Benchmarks')||
    !['open','active'].includes(market?.status)||market?.result&&market.result!=='not_determined'||
    market?.event_ticker!==event?.event_ticker||!market?.ticker)return null;
  const primary=normalized(market.rules_primary),secondary=normalized(market.rules_secondary);
  if(!/^If (?:a qualifying one-minute average|the price of [A-Z0-9]+ after issuance)/i.test(primary)||
    !/\b(?:after issuance|throughout the market duration)\b/i.test(primary+' '+secondary)||
    !/\b(?:each minute|single minute)\b/i.test(secondary)||
    !/\bCF Benchmarks\b|\bCF [A-Z0-9]+ price\b/i.test(secondary))return null;
  const direction=primary.match(/\b(?:is|is ever) (above|below)\s*\$\s*([\d,]+(?:\.\d+)?)/i);
  const index=(primary.match(/\(([A-Z0-9_]+_RTI|BRTI)\)/)||
    secondary.match(/\bCF (BRTI|[A-Z0-9]+USD_RTI) price\b/))?.[1];
  const threshold=Number(direction?.[2]?.replaceAll(',',''));
  const method=/\b(?:discard the highest 20% and lowest 20%|top 20% and bottom 20%)/i.test(secondary)?'trim20':
    /\bsimple average\b.*\bwithout trimming\b/i.test(secondary)?'simple':null;
  const open=Date.parse(market.open_time||''),end=Date.parse(market.expected_expiration_time||'');
  const subtitle=normalized(market.yes_sub_title);
  if(!direction||!index||!method||!Number.isFinite(threshold)||threshold<=0||
    !Number.isFinite(open)||!Number.isFinite(end)||open>=end||
    Number(market.floor_strike)!==threshold||
    !new RegExp('^'+direction[1]+'\\s*\\$','i').test(subtitle))return null;
  return {ticker:market.ticker,eventTicker:event.event_ticker,index,direction:direction[1].toLowerCase(),
    threshold,method,open,end,key:JSON.stringify([market.ticker,event.event_ticker,primary,secondary,
      market.open_time,market.expected_expiration_time,market.close_time,index,threshold,method])};
}

export function qualifyingCryptoMinute(contract,raw,now=Date.now(),targetMinute=null){
  return cryptoMinuteResult(contract,raw,now,targetMinute).observation;
}

export function cryptoMinuteResult(contract,raw,now=Date.now(),targetMinute=null){
  const values=raw?.data?.payload;
  if(!contract||!Array.isArray(values)||values.length>30_000)
    return {observation:null,reason:'missing_feed'};
  const minutes=new Map();
  for(const point of values){
    const time=Number(point?.time),price=Number(point?.value);
    if(!Number.isSafeInteger(time)||!Number.isFinite(price)||price<=0||point.repeatOfPreviousValue===true)continue;
    const start=Math.floor(time/60_000)*60_000;
    if(targetMinute!==null&&start!==targetMinute)continue;
    if(start<contract.open||start+60_000>contract.end||start+60_000>now||
      now-(start+60_000)>5*60_000)continue;
    const slot=Math.floor((time-start)/1000),minute=minutes.get(start)||new Map();
    // PER_SECOND values must cover every second; a duplicate or a changed
    // value for the same second invalidates that minute rather than averaging twice.
    if(minute.has(slot))minute.set(slot,null);else minute.set(slot,price);
    minutes.set(start,minute);
  }
  let complete=false;
  for(const [start,minute] of [...minutes].sort((a,b)=>b[0]-a[0])){
    if(minute.size!==60||[...minute.values()].some(v=>v===null))continue;
    complete=true;
    const sorted=[...minute.values()].sort((a,b)=>a-b);
    const kept=contract.method==='trim20'?sorted.slice(12,48):sorted;
    const average=kept.reduce((sum,value)=>sum+value,0)/kept.length;
    if(!(contract.direction==='above'?average>contract.threshold:average<contract.threshold))continue;
    const fingerprint=createHash('sha256').update(JSON.stringify([...minute.entries()].sort((a,b)=>a[0]-b[0]))).digest('hex');
    return {observation:{ticker:contract.ticker,contractKey:contract.key,index:contract.index,minute:start,
      method:contract.method,average,fingerprint,checkedAt:now}};
  }
  return {observation:null,reason:complete?'not_crossed':minutes.size?'incomplete_minute':'no_recent_data'};
}

export function pairedCryptoProof(first,second,now=Date.now()){
  return Boolean(first&&second&&first.ticker===second.ticker&&first.contractKey===second.contractKey&&
    first.index===second.index&&first.minute===second.minute&&first.method===second.method&&
    first.fingerprint===second.fingerprint&&first.average===second.average&&
    second.checkedAt-first.checkedAt>=CRYPTO_PROOF_DELAY_MS&&
    second.checkedAt-first.checkedAt<=2*60_000&&second.checkedAt<=now&&now-second.checkedAt<=10_000);
}

export function tripleCryptoProof(first,second,third,now=Date.now()){
  return Boolean(pairedCryptoProof(first,second,second?.checkedAt)&&
    pairedCryptoProof(second,third,now)&&third.checkedAt-second.checkedAt>=20_000);
}
