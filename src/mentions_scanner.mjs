import {mentionContract,mentionDay,mentionTickerDay,mentionEventTime,mentionEntryPrice,mentionObservation,pairedMentionProof} from './mentions.mjs';

// Every pass is bounded. A missing transcript never holds the rest of the
// catalog behind a retry or a 45-second sleep; the next tick resumes windows.
export async function scanMentionMarkets({kalshi,sources,readTranscript,getWindow,saveWindow,onVerified,
  now=()=>Date.now(),cycle=Math.floor(now()/60_000),maxSeries=48}={}){
  const stats={series:0,events:0,markets:0,priced:0,scheduledLater:0,sourceUnavailable:0,
    firstChecks:0,pairedChecks:0,errors:0,sample:[],surveyed:[]};
  const catalog=(await kalshi('/series?category=Mentions')).series||[];
  stats.series=catalog.length;
  // Known future events need only a date comparison until their event day.
  // Do not refetch their event, quote, or transcript on every minute tick.
  const future=new Set([...sources.keys()].filter(ticker=>sources.get(ticker)?.eventDate>
    mentionDay(now(),sources.get(ticker)?.timezone||'America/New_York')));
  const mapped=[...sources.keys()].filter(ticker=>sources.get(ticker)?.eventDate===
    mentionDay(now(),sources.get(ticker)?.timezone||'America/New_York'));
  const events=new Map();
  for(let i=0;i<mapped.length;i+=35){
    const query=new URLSearchParams({tickers:mapped.slice(i,i+35).join(','),with_nested_markets:'true',limit:'200',status:'open'});
    try{for(const event of (await kalshi('/events?'+query)).events||[])events.set(event.event_ticker,event)}
    catch{stats.errors++}
  }
  // Survey the rotating remainder for visibility. Configured sources always
  // take priority and are never displaced by a large unmapped universe.
  const ordered=[...catalog].sort((a,b)=>
    (Date.parse(b.last_updated_ts||'')||0)-(Date.parse(a.last_updated_ts||'')||0)||
    a.ticker.localeCompare(b.ticker));
  const recent=ordered.slice(0,Math.min(12,Math.ceil(maxSeries/2)));
  const rotating=ordered.slice(recent.length);
  const selection=[...recent];
  for(let i=0;i<Math.min(maxSeries-recent.length,rotating.length);i++)
    selection.push(rotating[(cycle*(maxSeries-recent.length)+i)%rotating.length]);
  stats.surveyed=selection.map(series=>series.ticker);
  // Bound concurrent API reads while covering the rotating catalog promptly.
  for(let offset=0;offset<selection.length;offset+=4){
    const batch=await Promise.all(selection.slice(offset,offset+4).map(async series=>{
      const query=new URLSearchParams({series_ticker:series.ticker,status:'open',limit:'200',with_nested_markets:'true'});
      try{return (await kalshi('/events?'+query)).events||[]}
      catch{stats.errors++;return []}
    }));
    for(const group of batch)for(const event of group)events.set(event.event_ticker,event);
  }
  const bySeries=new Map(catalog.map(s=>[s.ticker,s]));
  for(const event of events.values())if(sources.has(event.event_ticker)&&!bySeries.has(event.series_ticker)){
    try{const {series}=await kalshi('/series/'+encodeURIComponent(event.series_ticker));
      if(series)bySeries.set(event.series_ticker,series)}catch{stats.errors++}
  }
  const lowestAsk=event=>Math.min(...(event.markets||[]).flatMap(market=>
    ['yes','no'].map(side=>market[side+'_ask_dollars']).filter(mentionEntryPrice).map(Number)),Infinity);
  const prioritized=[...events.values()].sort((a,b)=>
    Number(sources.has(b.event_ticker))-Number(sources.has(a.event_ticker))||lowestAsk(a)-lowestAsk(b));
  for(const event of prioritized){
    if(mentionTickerDay(event.event_ticker)>mentionDay(now(),sources.get(event.event_ticker)?.timezone||'America/New_York')){
      future.add(event.event_ticker);continue;
    }
    stats.events++;
    const series=bySeries.get(event.series_ticker);
    const candidates=[];
    for(const market of event.markets||[]){
      const contract=mentionContract(event,market,series);
      if(!contract)continue;
      stats.markets++;
      if(stats.sample.length<8)stats.sample.push({ticker:market.ticker,event:event.event_ticker,
        day:mentionTickerDay(event.event_ticker),yes:market.yes_ask_dollars,no:market.no_ask_dollars});
      for(const side of ['yes','no']){
        candidates.push({event,market,series,contract,side});
        if(mentionEntryPrice(market[side+'_ask_dollars']))stats.priced++;
      }
    }
    if(!candidates.length)continue;
    const price=c=>mentionEntryPrice(c.market[c.side+'_ask_dollars'])?
      Number(c.market[c.side+'_ask_dollars']):Infinity;
    candidates.sort((a,b)=>price(a)-price(b));
    const priced=candidates.filter(c=>price(c)<Infinity).length;
    const descriptor=sources.get(event.event_ticker);
    const scheduled=mentionTickerDay(event.event_ticker);
    if(descriptor&&scheduled&&scheduled!==descriptor.eventDate){stats.sourceUnavailable+=priced;continue}
    if(!descriptor||descriptor.eventDate!==mentionDay(now(),descriptor.timezone||'America/New_York')){
      stats.sourceUnavailable+=priced;continue;
    }
    const timed=candidates.filter(candidate=>mentionEventTime(event,candidate.market,descriptor));
    stats.sourceUnavailable+=priced-timed.filter(c=>price(c)<Infinity).length;
    if(!timed.length)continue;
    let transcript;
    try{transcript=await readTranscript(descriptor)}catch{stats.errors++;continue}
    if(!transcript){stats.sourceUnavailable+=timed.filter(c=>price(c)<Infinity).length;continue}
    for(const candidate of timed){
      const observation=mentionObservation(candidate.contract,transcript,{now:now(),side:candidate.side});
      if(!observation)continue;
      try{
        const first=await getWindow(candidate.market.ticker,candidate.side);
        if(!pairedMentionProof(first,observation,now())){
          // Keep a valid early check until its 45-second deadline; changed
          // source text or contract rules start a fresh window.
          if(!first||first.contentHash!==observation.contentHash||first.contractKey!==observation.contractKey||
            first.eventDate!==observation.eventDate||first.sourceUrl!==observation.sourceUrl||
            first.side!==observation.side||observation.checkedAt-first.checkedAt>30*60_000){
            await saveWindow(observation);stats.firstChecks++;
          }
          continue;
        }
        if(!mentionEntryPrice(candidate.market[candidate.side+'_ask_dollars']))continue;
        stats.pairedChecks++;
        await onVerified({...candidate,first,second:observation,transcript});
      }catch{stats.errors++}
    }
  }
  stats.scheduledLater=future.size;
  return stats;
}
