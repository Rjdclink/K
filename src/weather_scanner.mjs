import {weatherSeries,weatherContract,stationTimezone,observedWeather} from './weather.mjs';

// Discovery is separated from the sports live-data feed. Every series is
// queried, including cities not known when the function was deployed.
export async function scanWeatherMarkets({kalshi,nws,onVerified,now=()=>new Date(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const catalog=(await kalshi('/series?category=Climate%20and%20Weather')).series?.filter(weatherSeries)||[];
  const stats={series:catalog.length,events:0,eligible:0,verified:0,failures:0};
  let cursor=0;const stations=new Map();
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
            const date=String(event.title||'').match(/\bon (\w+ \d{1,2}, 20\d{2})\b/i)?.[1];
            if(!date)continue;
            const eventDate=new Date(date+' 12:00:00 GMT');
            if(!Number.isFinite(eventDate.getTime())||Math.abs(eventDate.getTime()-now().getTime())>36*3600000)continue;
            const id=event.markets?.[0]?.rules_primary?.match(/\(([A-Z][A-Z0-9]{2,7})\)/)?.[1];
            if(!/^K[A-Z0-9]{3}$/.test(id||''))continue;
            if(!stations.has(id))stations.set(id,nws('/stations/'+id).then(data=>{
              if(data.properties?.stationIdentifier&&data.properties.stationIdentifier!==id)return null;
              return {id,timezone:stationTimezone(data)};
            }).catch(()=>null));
            const station=await stations.get(id);
            if(!station?.timezone)continue;
            const candidates=(event.markets||[]).map(market=>({event,market,contract:weatherContract(event,market,station,now())})).filter(c=>c.contract);
            stats.eligible+=candidates.length;
            // Price and volume are only screening hints; executable depth is
            // checked again by the order path before a FOK submission.
            const priced=candidates.filter(c=>Number(c.market.yes_ask_size_fp)>0&&Number(c.market.yes_ask_dollars)>0&&Number(c.market.yes_ask_dollars)<1);
            if(!priced.length)continue;
            const verified=[];
            await Promise.all(priced.map(async candidate=>{
              try{
                const firstAt=now();const first=(await kalshi('/markets/'+encodeURIComponent(candidate.market.ticker))).market;
                if(!first||!weatherContract(event,first,station,firstAt))return;
                await pause(20000);
                const secondAt=now();const second=(await kalshi('/markets/'+encodeURIComponent(candidate.market.ticker))).market;
                if(secondAt.getTime()-firstAt.getTime()<20000)return;
                const current=weatherContract(event,second,station,secondAt);
                if(!current||first.rules_primary!==second.rules_primary||first.close_time!==second.close_time||
                  first.floor_strike!==second.floor_strike||first.cap_strike!==second.cap_strike)return;
                const observations=await nws('/stations/'+id+'/observations?'+new URLSearchParams({start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString(),limit:'500'}));
                const observed=observedWeather(current,observations.features,now());
                if(!observed)return;
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
