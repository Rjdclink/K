import {mentionContract,mentionDay,mentionTickerDay,mentionEventTime,mentionEntryPrice,mentionObservation,pairedMentionProof,tripleMentionProof} from './mentions.mjs';
import {mentionRuleSources,boundMentionSource} from './mentions_rules_source.mjs';

// Every pass is bounded. A missing transcript never holds the rest of the
// catalog behind a retry or a timed sleep; the next tick resumes windows.
export async function scanMentionMarkets({kalshi,sources,readTranscript,getWindow,saveWindow,clearWindow,onVerified,
  now=()=>Date.now(),cycle=Math.floor(now()/60_000),maxSeries=48,seriesCatalog}={}){
  const stats={series:0,events:0,markets:0,contracts:0,todayEvents:0,todayMarkets:0,
    priced:0,scheduledLater:0,sourceUnavailable:0,todayTickers:[],ruleSources:[],
    firstChecks:0,pairedChecks:0,thirdChecks:0,errors:0,sample:[],surveyed:[],seriesSchedule:{}};
  const catalog=seriesCatalog||(await kalshi('/series?category=Mentions')).series||[];
  stats.series=catalog.length;
  // Known future events need only a date comparison until their event day.
  // Do not refetch their event, quote, or transcript on every minute tick.
  const future=new Set([...sources.keys()].filter(ticker=>sources.get(ticker)?.eventDate>
    mentionDay(now(),sources.get(ticker)?.timezone||'America/New_York')));
  const mapped=[...sources.keys()].filter(ticker=>sources.get(ticker)?.eventDate===
    mentionDay(now(),sources.get(ticker)?.timezone||'America/New_York'));
  const events=new Map(),todayTickers=new Set();
  for(let i=0;i<mapped.length;i+=35){
    const query=new URLSearchParams({tickers:mapped.slice(i,i+35).join(','),with_nested_markets:'true',limit:'200',status:'open'});
    try{for(const event of (await kalshi('/events?'+query)).events||[])events.set(event.event_ticker,event)}
    catch{stats.errors++}
  }
  // Survey every selected series for event dates without nesting markets.
  // Market details are fetched only for events whose ticker names today.
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
      const query=new URLSearchParams({series_ticker:series.ticker,status:'open',limit:'200',with_nested_markets:'false'});
      try{const result=await kalshi('/events?'+query);
        if(result.cursor){stats.errors++;return []}
        const group=result.events||[],today=mentionDay(now(),'America/New_York');
        const days=group.map(event=>mentionTickerDay(event.event_ticker)).filter(Boolean);
        stats.seriesSchedule[series.ticker]={updatedAt:series.last_updated_ts||null,
          checkedAt:now(),today:days.includes(today),
          future:days.filter(day=>day>today).length};
        return group}
      catch{stats.errors++;return []}
    }));
    for(const group of batch)for(const event of group){
      const date=mentionTickerDay(event.event_ticker),today=mentionDay(now(),'America/New_York');
      if(date>today)future.add(event.event_ticker);
      else if(date===today)todayTickers.add(event.event_ticker);
    }
  }
  for(const ticker of events.keys())todayTickers.delete(ticker);
  const todayList=[...todayTickers];
  for(let i=0;i<todayList.length;i+=35){
    const query=new URLSearchParams({tickers:todayList.slice(i,i+35).join(','),status:'open',
      limit:'200',with_nested_markets:'true'});
    try{for(const event of (await kalshi('/events?'+query)).events||[])events.set(event.event_ticker,event)}
    catch{stats.errors++}
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
    const today=mentionTickerDay(event.event_ticker)===mentionDay(now(),sources.get(event.event_ticker)?.timezone||'America/New_York');
    if(today){stats.todayEvents++;stats.todayTickers.push(event.event_ticker);
      stats.ruleSources.push({eventTicker:event.event_ticker,sources:mentionRuleSources(event)})}
    const series=bySeries.get(event.series_ticker);
    const candidates=[];
    for(const market of event.markets||[]){
      if(!['open','active'].includes(market.status))continue;
      stats.markets++;if(today)stats.todayMarkets++;
      if(stats.sample.length<8)stats.sample.push({ticker:market.ticker,event:event.event_ticker,
        day:mentionTickerDay(event.event_ticker),yes:market.yes_ask_dollars,no:market.no_ask_dollars});
      for(const side of ['yes','no'])if(mentionEntryPrice(market[side+'_ask_dollars']))stats.priced++;
      const contract=mentionContract(event,market,series);
      if(!contract)continue;
      stats.contracts++;
      for(const side of ['yes','no']){
        candidates.push({event,market,series,contract,side});
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
    if(!boundMentionSource(event,descriptor)||
      descriptor.eventDate!==mentionDay(now(),descriptor.timezone||'America/New_York')){
      stats.sourceUnavailable+=priced;continue;
    }
    const timed=candidates.filter(candidate=>mentionEventTime(event,candidate.market,descriptor));
    stats.sourceUnavailable+=priced-timed.filter(c=>price(c)<Infinity).length;
    if(!timed.length)continue;
    let transcript;
    try{transcript=await readTranscript(descriptor)}catch{stats.errors++;transcript=null}
    if(!transcript){stats.sourceUnavailable+=timed.filter(c=>price(c)<Infinity).length;
      for(const candidate of timed)await clearWindow?.(candidate.market.ticker,candidate.side);
      continue}
    for(const candidate of timed){
      const observation=mentionObservation(candidate.contract,transcript,{now:now(),side:candidate.side});
      if(!observation){await clearWindow?.(candidate.market.ticker,candidate.side);continue}
      try{
        const first=await getWindow(candidate.market.ticker,candidate.side);
        if(!pairedMentionProof(first,observation,now())){
          // Keep a valid early check until the next 50-second read; changed
          // source text or contract rules start a fresh window.
          if(!first||first.contentHash!==observation.contentHash||first.contractKey!==observation.contractKey||
            first.eventDate!==observation.eventDate||first.sourceUrl!==observation.sourceUrl||
            first.side!==observation.side||observation.checkedAt-first.checkedAt>30*60_000){
            await saveWindow(observation);stats.firstChecks++;
          }
          continue;
        }
        if(!first.second){
          await saveWindow({...first,second:observation});stats.pairedChecks++;continue;
        }
        if(observation.checkedAt-first.second.checkedAt<30_000)continue;
        if(!tripleMentionProof(first,first.second,observation,now())){
          await saveWindow(observation);stats.firstChecks++;continue;
        }
        if(!mentionEntryPrice(candidate.market[candidate.side+'_ask_dollars']))continue;
        stats.thirdChecks++;
        await onVerified({...candidate,first,second:first.second,third:observation,transcript});
      }catch{stats.errors++}
    }
  }
  stats.scheduledLater=future.size;
  return stats;
}
