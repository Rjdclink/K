import {weatherSeries,weatherContract,weatherDate,weatherStationId,stationTimezone,observedWeather,observedWeatherCompany} from './weather.mjs';

// Discovery is separated from the sports live-data feed. Every series is
// queried, including cities not known when the function was deployed.
export async function scanWeatherMarkets({kalshi,nws,twc,onVerified,now=()=>new Date(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const catalog=(await kalshi('/series?category=Climate%20and%20Weather')).series?.filter(weatherSeries)||[];
  const stats={series:catalog.length,events:0,eligible:0,verified:0,failures:0,companyProbe:null,companyObservationFeed:null,thresholdSamples:[],
    sources:{},rejections:{dateMissing:0,dateOutsideWindow:0,stationMissing:0,stationIdUnsupported:0,stationUnavailable:0,contractRules:0,noAsk:0,noObservation:0,observationFeedUnavailable:0,observationStationMissing:0,observationNotSettled:0,thresholdNotCrossed:0}};
  let cursor=0;const stations=new Map(),climateDays=new Map(),metarWeeks=new Map();
  const companyDay=label=>{
    if(!climateDays.has(label))climateDays.set(label,twc('/api/climate/primary?date='+label).catch(()=>null));
    return climateDays.get(label);
  };
  const companyObservations=label=>{
    const day=new Date(label+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
    const monday=day.toISOString().slice(0,10);
    if(!metarWeeks.has(monday))metarWeeks.set(monday,twc('/api/metar?primary=true&weekStart='+monday).then(data=>{
      stats.companyObservationFeed={available:data?.source==='live'&&Array.isArray(data?.stations),stations:data?.stations?.length||0,fetchedAt:data?.fetchedAt||null};
      return data;
    }).catch(()=>{stats.companyObservationFeed={available:false,stations:0};return null}));
    return metarWeeks.get(monday);
  };
  await Promise.all(Array.from({length:Math.min(8,catalog.length)},async()=>{
    while(cursor<catalog.length){const series=catalog[cursor++];
      try{
        let pageCursor='';
        for(let page=0;page<3;page++){
          const query=new URLSearchParams({series_ticker:series.ticker,status:'open',limit:'200',with_nested_markets:'true'});
          if(pageCursor)query.set('cursor',pageCursor);
          const response=await kalshi('/events?'+query);
          for(const event of response.events||[]){
            stats.events++;
            const source=event.settlement_sources?.[0]?.name||'unspecified';
            stats.sources[source]=(stats.sources[source]||0)+1;
            if(source==='The Weather Company'&&stats.companyProbe===null){
              // Probe the actual station catalog even outside an entry window,
              // so a blocked feed is visible before the next eligible market.
              const report=await companyDay(now().toISOString().slice(0,10));
              stats.companyProbe={available:Array.isArray(report?.results),stations:report?.results?.length||0};
            }
            const date=weatherDate(event);
            if(!date){stats.rejections.dateMissing++;continue}
            const eventDate=new Date(date+' 12:00:00 GMT');
            if(!Number.isFinite(eventDate.getTime())||Math.abs(eventDate.getTime()-now().getTime())>36*3600000){stats.rejections.dateOutsideWindow++;continue}
            const id=weatherStationId(event.markets?.[0]?.rules_primary);
            if(!id){stats.rejections.stationMissing++;continue}
            const company=source==='The Weather Company';
            if(company?!/^CLI[A-Z0-9]{3,5}$/.test(id):!/^K[A-Z0-9]{3}$/.test(id)){stats.rejections.stationIdUnsupported++;continue}
            if(!stations.has(id))stations.set(id,company?companyDay(eventDate.toISOString().slice(0,10)).then(data=>{
              const matches=(data?.results||[]).filter(x=>x.station?.cliId&&'CLI'+x.station.cliId===id&&x.station.icao==='K'+x.station.cliId);
              return matches.length===1?{id,icao:matches[0].station.icao,timezone:matches[0].station.timezone}:null;
            }):nws('/stations/'+id).then(data=>{
              if(data.properties?.stationIdentifier&&data.properties.stationIdentifier!==id)return null;
              return {id,timezone:stationTimezone(data)};
            }).catch(()=>null));
            const station=await stations.get(id);
            if(!station?.timezone){stats.rejections.stationUnavailable++;continue}
            const candidates=(event.markets||[]).map(market=>({event,market,contract:weatherContract(event,market,station,now())})).filter(c=>c.contract);
            if(!candidates.length)stats.rejections.contractRules++;
            stats.eligible+=candidates.length;
            // Price and volume are only screening hints; executable depth is
            // checked again by the order path before a FOK submission.
            const priced=candidates.filter(c=>Number(c.market.yes_ask_size_fp)>0&&Number(c.market.yes_ask_dollars)>0&&Number(c.market.yes_ask_dollars)<1);
            if(!priced.length){if(candidates.length)stats.rejections.noAsk++;continue}
            const verified=[];
            await Promise.all(priced.map(async candidate=>{
              try{
                const firstAt=now();const first=(await kalshi('/markets/'+encodeURIComponent(candidate.market.ticker))).market;
                if(!first||!weatherContract(event,first,station,firstAt))return;
                await pause(3000);
                const secondAt=now();const second=(await kalshi('/markets/'+encodeURIComponent(candidate.market.ticker))).market;
                if(secondAt.getTime()-firstAt.getTime()<3000)return;
                const current=weatherContract(event,second,station,secondAt);
                if(!current||first.rules_primary!==second.rules_primary||first.close_time!==second.close_time||
                  first.floor_strike!==second.floor_strike||first.cap_strike!==second.cap_strike)return;
                const feed=company?await companyObservations(current.localDate):null;
                const observed=company?observedWeatherCompany(current,feed,now()):
                  observedWeather(current,(await nws('/stations/'+id+'/observations?'+new URLSearchParams({start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString(),limit:'500'}))).features,now());
                if(!observed){
                  stats.rejections.noObservation++;
                  if(company){
                    const fetched=Date.parse(feed?.fetchedAt||''),time=now().getTime();
                    const stationFeed=feed?.stations?.filter(s=>s.icaoId===current.icao&&s.timezone===current.timezone);
                    if(feed?.source!=='live'||!Number.isFinite(fetched)||fetched>time+30000||time-fetched>20*60000)stats.rejections.observationFeedUnavailable++;
                    else if(stationFeed?.length!==1)stats.rejections.observationStationMissing++;
                    else if(!(stationFeed[0].observations||[]).some(o=>o.icaoId===current.icao&&o.localDate===current.localDate&&o.status==='settled'&&Number.isFinite(o.tempF)&&Date.parse(o.reportTimeUTC)>=current.start&&Date.parse(o.reportTimeUTC)<current.end&&Date.parse(o.reportTimeUTC)<=time))stats.rejections.observationNotSettled++;
                    else{
                      stats.rejections.thresholdNotCrossed++;
                      if(stats.thresholdSamples.length<5){
                        const readings=stationFeed[0].observations.filter(o=>o.icaoId===current.icao&&o.localDate===current.localDate&&o.status==='settled'&&Number.isFinite(o.tempF)&&Date.parse(o.reportTimeUTC)>=current.start&&Date.parse(o.reportTimeUTC)<current.end&&Date.parse(o.reportTimeUTC)<=time);
                        const extreme=current.type==='high'?Math.max(...readings.map(o=>o.tempF)):Math.min(...readings.map(o=>o.tempF));
                        stats.thresholdSamples.push({ticker:current.ticker,station:current.station,type:current.type,threshold:current.threshold,settledExtremeF:extreme});
                      }
                    }
                  }
                  return;
                }
                stats.verified++;
                verified.push({event,market:second,contract:current,observed,firstAt,secondAt,first,second});
              }catch(e){stats.failures++}
            }));
            if(verified.length)await onVerified(verified);
          }
          pageCursor=response.cursor||'';if(!pageCursor)break;
        }
      }catch(e){stats.failures++}
    }
  }));
  return stats;
}

