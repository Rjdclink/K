import timezoneAt from 'tz-lookup';

const dayKey=(at,zone)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
  const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
function offsetHours(zone,at){
  const label=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'shortOffset'}).formatToParts(at).find(p=>p.type==='timeZoneName')?.value||'';
  const found=label.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
  return found?(found[1]==='-'?-1:1)*(Number(found[2]||0)+Number(found[3]||0)/60):NaN;
}
function standardOffset(zone,year){return Math.min(offsetHours(zone,new Date(Date.UTC(year,0,15))),offsetHours(zone,new Date(Date.UTC(year,6,15))))}
function localMidnight(label,zone){
  const [year,month,day]=label.split('-').map(Number),at=Date.UTC(year,month-1,day);
  let midnight=at-offsetHours(zone,new Date(at))*3600000;
  return at-offsetHours(zone,new Date(midnight))*3600000;
}
function nextDay(label){const [year,month,day]=label.split('-').map(Number);return new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10)}
function finalLocalMinute(label,zone){return localMidnight(nextDay(label),zone)-60000}
export function weatherDate(event){
  const title=String(event?.title||''),named=title.match(/\bon (\w+ \d{1,2}, 20\d{2})\b/i)?.[1];
  if(named)return named;
  const ticker=String(event?.event_ticker||'').match(/-(\d{2})([A-Z]{3})(\d{2})$/),months='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  const month=months.indexOf(ticker?.[2]);if(month<0)return null;
  const at=new Date(Date.UTC(2000+Number(ticker[1]),month,Number(ticker[3])));
  return at.getUTCMonth()===month&&at.getUTCDate()===Number(ticker[3])?`${months[month][0]+months[month].slice(1).toLowerCase()} ${at.getUTCDate()}, ${at.getUTCFullYear()}`:null;
}
export function weatherStationId(rule){return String(rule||'').match(/\bCLI[A-Z0-9]{3,5}\b|\(([A-Z][A-Z0-9]{2,7})\)/)?.[0].replace(/[()]/g,'')||null}
export function weatherSeries(series){return /rain|precipitation|(?:highest|maximum|max|lowest|minimum|low|high)\s+(?:temperature|temp)|(?:temperature|temp)\s+(?:high|low)|hourly directional|city temperature/i.test(String(series?.title||''))}
export function weatherContract(event,market,station,now=new Date()){
  if(event?.category!=='Climate and Weather'||!['active','open'].includes(market?.status)||market?.result)return null;
  const rule=String(market.rules_primary||''),title=String(event.title||'');
  const date=weatherDate(event);
  const stationId=weatherStationId(rule);
  const source=event.settlement_sources?.[0]?.name;
  if(!date||!stationId||station?.id!==stationId||!station?.timezone||!['National Weather Service','The Weather Company'].includes(source))return null;
  if(source==='National Weather Service'&&!/^K[A-Z0-9]{3}$/.test(stationId))return null;
  if(source==='The Weather Company'&&(!/^CLI[A-Z0-9]{3,5}$/.test(stationId)||station.icao!==`K${stationId.slice(3)}`))return null;
  const declared=new Date(`${date} 12:00:00 GMT`);
  if(!Number.isFinite(declared.getTime()))return null;
  const label=declared.toISOString().slice(0,10),zone=station.timezone;
  if(dayKey(now,zone)!==label)return null;
  const close=Date.parse(market.close_time||'');
  const cutoff=Math.min(close,finalLocalMinute(label,zone));
  if(!Number.isFinite(cutoff)||now.getTime()<localMidnight(label,zone)||now.getTime()>=cutoff)return null;
  const hourly=/\bat \d{1,2}\s*(?:am|pm)\s+[A-Z]{2,5}\b/i.test(title);
  let start,end;
  if(hourly){
    if(source==='The Weather Company')return null; // Cannot verify an unobserved instant before its close.
    end=Date.parse(event.strike_date||'');
    if(!Number.isFinite(end)||!rule.includes(date)||!/\bat \d{1,2}\s*(?:AM|PM)\b/i.test(rule))return null;
    start=end; // An instantaneous observation; no prior measurement may substitute.
  }else if(source==='The Weather Company'){
    start=localMidnight(label,zone);end=localMidnight(nextDay(label),zone);
  }else{
    const [year,month,day]=label.split('-').map(Number),offset=standardOffset(zone,year);
    if(!Number.isFinite(offset)||!rule.includes(date))return null;
    start=Date.UTC(year,month-1,day)-offset*3600000;
    end=start+86400000;
    // The NWS standard-time climate day can extend into tomorrow during DST;
    // observations after the current local date are never read at entry time.
    if(dayKey(new Date(start),zone)!==label)return null;
  }
  const rain=/\bprecipitation\b|\brain\b/i.test(`${title} ${rule}`);
  const high=/\bmaximum temperature\b|\bhighest temperature\b/i.test(`${title} ${rule}`);
  const low=/\bminimum temperature\b|\blowest temperature\b/i.test(`${title} ${rule}`);
  const type=rain?'rain':high?'high':low?'low':hourly?'temperature':null;
  const threshold=Number(market.floor_strike??market.cap_strike);
  if(!type||!Number.isFinite(threshold)||!['greater','less','greater_than','less_than'].includes(market.strike_type))return null;
  if(hourly||type==='rain'&&!market.strike_type.startsWith('greater')||type==='high'&&!market.strike_type.startsWith('greater')||type==='low'&&!market.strike_type.startsWith('less'))return null;
  if(source==='The Weather Company'&&!['high','low'].includes(type))return null; // Same-day rain is absent from the official observed feed.
  // A range can be invalidated by later readings. It needs a different proof.
  if(market.floor_strike!=null&&market.cap_strike!=null)return null;
  return {eventTicker:event.event_ticker,ticker:market.ticker,station:stationId,icao:station.icao||null,timezone:zone,source,type,threshold,comparison:market.strike_type,start,end,close:cutoff,localDate:label};
}
export function stationTimezone(station){
  const [longitude,latitude]=station?.geometry?.coordinates||[];
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  try{return timezoneAt(latitude,longitude)}catch{return null}
}
export function observedWeather(contract,observations,now=new Date()){
  if(!contract||!Array.isArray(observations))return null;
  const values=observations.filter(o=>{
    const at=Date.parse(o.properties?.timestamp||'');
    return o.properties?.station?.endsWith('/'+contract.station) && at>=contract.start && at<contract.end && at<=now.getTime() &&
      o.properties?.temperature?.qualityControl!=='X' && o.properties?.precipitationLastHour?.qualityControl!=='X';
  }).map(o=>{
    const p=o.properties,raw=contract.type==='rain'?p.precipitationLastHour?.value:p.temperature?.value;
    return {at:p.timestamp,value:typeof raw==='number'?contract.type==='rain'?raw/25.4:raw*9/5+32:NaN};
  }).filter(o=>Number.isFinite(o.value));
  if(!values.length)return null;
  const chosen=contract.comparison.startsWith('greater')?values.sort((a,b)=>b.value-a.value)[0]:values.sort((a,b)=>a.value-b.value)[0];
  // For rain a single verified hourly amount above the daily threshold suffices.
  // Directional temperature follows the contract's strict comparison.
  const buffer=contract.type==='rain'?1e-8:0;
  const passed=contract.comparison.startsWith('greater')?chosen.value>contract.threshold+buffer:chosen.value<contract.threshold-buffer;
  return passed?{...chosen,source:'National Weather Service',station:contract.station}:null;
}
export function observedWeatherCompany(contract,data,now=new Date()){
  if(contract?.source!=='The Weather Company'||!['high','low'].includes(contract.type)||data?.source!=='live'||!Array.isArray(data.stations))return null;
  const fetched=Date.parse(data.fetchedAt||'');
  if(!Number.isFinite(fetched)||fetched>now.getTime()+30000||now.getTime()-fetched>20*60000)return null;
  const stations=data.stations.filter(s=>s.icaoId===contract.icao&&s.timezone===contract.timezone);
  if(stations.length!==1)return null;
  const values=(stations[0].observations||[]).filter(o=>o.icaoId===contract.icao&&o.localDate===contract.localDate&&o.status==='settled'&&
    Number.isFinite(o.tempF)&&Date.parse(o.reportTimeUTC)>=contract.start&&Date.parse(o.reportTimeUTC)<contract.end&&Date.parse(o.reportTimeUTC)<=now.getTime())
    .map(o=>({at:o.reportTimeUTC,value:o.tempF}));
  if(!values.length)return null;
  const chosen=values.sort((a,b)=>contract.type==='high'?b.value-a.value:a.value-b.value)[0];
  // Only a settled observation strictly beyond the contract line qualifies.
  const passed=contract.type==='high'?chosen.value>contract.threshold:chosen.value<contract.threshold;
  return passed?{...chosen,source:'The Weather Company',station:contract.station,icao:contract.icao,status:'settled'}:null;
}

