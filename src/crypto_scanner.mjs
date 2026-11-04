import {cryptoHitContract,qualifyingCryptoMinute,pairedCryptoProof,tripleCryptoProof} from './crypto_hit.mjs';

export async function scanCryptoHits({kalshi,readIndex,getWindow,saveWindow,clearWindow,onVerified,
  now=()=>Date.now(),maxSeries=80,tracked,onCandidates}={}){
  const stats={series:0,surveyed:0,events:0,markets:0,qualified:0,firstChecks:0,
    secondChecks:0,thirdChecks:0,errors:0,sourceUnavailable:0,sample:[]};
  const catalog=tracked?[]:(await kalshi('/series?category=Crypto')).series||[];
  const relevant=catalog.filter(s=>s.category==='Crypto'&&
    /(?:above|below|high|low|hit|touch|minimum|maximum)/i.test(s.title||'')&&
    s.settlement_sources?.some(source=>source.name==='CF Benchmarks'));
  stats.series=relevant.length;
  const seriesByTicker=new Map(relevant.map(s=>[s.ticker,s]));
  const candidates=tracked||[];
  for(let offset=0;offset<Math.min(relevant.length,maxSeries);offset+=4){
    const batch=await Promise.all(relevant.slice(offset,offset+4).map(async series=>{
      const query=new URLSearchParams({series_ticker:series.ticker,status:'open',limit:'200',with_nested_markets:'true'});
      try{return {series,result:await kalshi('/events?'+query)}}catch{return {series,error:true}}
    }));
    for(const {series,result,error} of batch){
      stats.surveyed++;
      if(error||result.cursor){stats.errors++;continue}
      for(const event of result.events||[]){
        stats.events++;
        for(const market of event.markets||[]){
          const contract=cryptoHitContract(event,market,seriesByTicker.get(event.series_ticker)||series);
          if(!contract||Date.parse(market.close_time||'')<=now())continue;
          stats.markets++;
          if(stats.sample.length<8)stats.sample.push({ticker:market.ticker,ask:market.yes_ask_dollars,
            index:contract.index,direction:contract.direction,threshold:contract.threshold});
          candidates.push({event,market,series,contract});
        }
      }
    }
  }
  const feeds=new Map();
  const active=[];
  candidates.sort((a,b)=>Number(a.market.yes_ask_dollars)-Number(b.market.yes_ask_dollars));
  for(const item of candidates){
    const {contract,market}=item;
    let window;
    try{window=await getWindow(market.ticker)}catch{stats.errors++;continue}
    if(!feeds.has(contract.index)){
      try{feeds.set(contract.index,await readIndex(contract.index))}
      catch{feeds.set(contract.index,null);stats.errors++}
    }
    const observation=qualifyingCryptoMinute(contract,feeds.get(contract.index),now(),window?.first?.minute??null);
    if(!observation){stats.sourceUnavailable++;await clearWindow?.(market.ticker);continue}
    stats.qualified++;
    try{
      const first=window?.first,second=window?.second;
      if(!first||first.contractKey!==observation.contractKey||first.minute!==observation.minute||
        first.fingerprint!==observation.fingerprint||observation.checkedAt-first.checkedAt>2*60_000){
        await saveWindow(market.ticker,{first:observation});stats.firstChecks++;active.push(item);continue;
      }
      if(!second){
        if(observation.checkedAt-first.checkedAt<15_000){active.push(item);continue}
        if(!pairedCryptoProof(first,observation,observation.checkedAt)){
          await saveWindow(market.ticker,{first:observation});stats.firstChecks++;active.push(item);continue;
        }
        await saveWindow(market.ticker,{first,second:observation});stats.secondChecks++;active.push(item);continue;
      }
      if(observation.checkedAt-second.checkedAt<20_000){active.push(item);continue}
      if(!tripleCryptoProof(first,second,observation,observation.checkedAt)){
        await saveWindow(market.ticker,{first:observation});stats.firstChecks++;active.push(item);continue;
      }
      stats.thirdChecks++;
      await onVerified({...item,first,second,third:observation});
    }catch{stats.errors++}
  }
  onCandidates?.(active);
  return stats;
}
