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
function finalLocalMinute(label,zone){
  const [year,month,day]=label.split('-').map(Number),next=Date.UTC(year,month-1,day+1);
  let midnight=next-offsetHours(zone,new Date(next))*3600000;
  midnight=next-offsetHours(zone,new Date(midnight))*3600000;
  return midnight-60000;
}
export function weatherSeries(series){return /rain|precipitation|(?:highest|maximum|max|lowest|minimum|low|high)\s+(?:temperature|temp)|(?:temperature|temp)\s+(?:high|low)|hourly directional|city temperature/i.test(String(series?.title||''))}
export function weatherContract(event,market,station,now=new Date()){
  if(event?.category!=='Climate and Weather'||!['active','open'].includes(market?.status)||market?.result)return null;
  const rule=String(market.rules_primary||''),title=String(event.title||'');
  const date=title.match(/\bon (\w+ \d{1,2}, 20\d{2})\b/i)?.[1];
  const stationId=rule.match(/\(([A-Z][A-Z0-9]{2,7})\)/)?.[1];
  const source=event.settlement_sources?.[0]?.name;
  // NWS station observations cannot establish a different provider's official
  // settlement value. Those contracts need their own provider-specific proof.
  if(!date||!stationId||station?.id!==stationId||!station?.timezone||source!=='National Weather Service')return null;
  const declared=new Date(`${date} 12:00:00 GMT`);
  if(!Number.isFinite(declared.getTime()))return null;
  const label=declared.toISOString().slice(0,10),zone=station.timezone;
  if(dayKey(now,zone)!==label)return null;
  const close=Date.parse(market.close_time||'');
  const cutoff=Math.min(close,finalLocalMinute(label,zone));
  if(!Number.isFinite(cutoff)||now.getTime()<cutoff-2*3600000||now.getTime()>=cutoff)return null;
  const hourly=/\bat \d{1,2}\s*(?:am|pm)\s+[A-Z]{2,5}\b/i.test(title);
  let start,end;
  if(hourly){
    end=Date.parse(event.strike_date||'');
    if(!Number.isFinite(end)||!rule.includes(date)||!/\bat \d{1,2}\s*(?:AM|PM)\b/i.test(rule))return null;
    start=end; // An instantaneous observation; no prior measurement may substitute.
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
  // A range can be invalidated by later readings. It needs a different proof.
  if(market.floor_strike!=null&&market.cap_strike!=null)return null;
  return {eventTicker:event.event_ticker,ticker:market.ticker,station:stationId,timezone:zone,source,type,threshold,comparison:market.strike_type,start,end,close:cutoff,localDate:label};
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
  // A directional temperature must clear the threshold beyond rounding noise.
  const buffer=contract.type==='rain'?1e-8:0.5;
  const passed=contract.comparison.startsWith('greater')?chosen.value>contract.threshold+buffer:chosen.value<contract.threshold-buffer;
  return passed?{...chosen,source:'National Weather Service',station:contract.station}:null;
}

