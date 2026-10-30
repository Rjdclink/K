import test from 'node:test';
import assert from 'node:assert/strict';
import {scanWeatherMarkets} from '../src/weather_scanner.mjs';

test('weather scanner checks the same Kalshi rule twice three seconds apart and a matching NWS station',async()=>{
  let time=Date.parse('2026-11-03T04:55:00Z'),reads=0,checked=[];
  const market={ticker:'RAIN',event_ticker:'RAIN-EVENT',status:'active',result:'',rules_primary:'If total precipitation at Central Park (KNYC) on Nov 2, 2026 is strictly greater than 0 inches, then Yes.',floor_strike:0,strike_type:'greater',close_time:'2026-11-03T05:00:00Z',yes_ask_dollars:'.90',yes_ask_size_fp:'10'};
  const event={event_ticker:'RAIN-EVENT',category:'Climate and Weather',title:'Rain in New York City on Nov 2, 2026?',settlement_sources:[{name:'National Weather Service'}],markets:[market]};
  const kalshi=async path=>{
    if(path.startsWith('/series?'))return {series:[{ticker:'RAIN',title:'Daily Rain - NYC'}]};
    if(path.startsWith('/events?'))return {events:[event]};
    if(path==='/markets/RAIN'){reads++;return {market}};
    throw Error(path);
  };
  const nws=async path=>path==='/stations/KNYC'?{geometry:{coordinates:[-73.97,40.78]}}:{features:[{properties:{station:'https://api.weather.gov/stations/KNYC',timestamp:'2026-11-03T04:30:00Z',precipitationLastHour:{value:2.54}}}]};
  const stats=await scanWeatherMarkets({kalshi,nws,now:()=>new Date(time),pause:async ms=>{time+=ms},onVerified:async legs=>checked.push(...legs)});
  assert.equal(reads,2);
  assert.equal(stats.verified,1);
  assert.equal(checked[0].secondAt-checked[0].firstAt,3000);
  assert.equal(checked[0].observed.station,'KNYC');
});
test('Weather Company candidate checks two Kalshi quotes and a settled same-day hourly observation, never a forecast',async()=>{
  let time=Date.parse('2026-10-30T03:15:00Z'),reads=0,verified=[];
  const market={ticker:'CHI-HIGH',event_ticker:'KXHIGHCHI-26OCT29',status:'active',result:'',rules_primary:'The maximum temperature recorded at Chicago (CLIMDW) for Oct 29, 2026 is greater than 67 degrees Fahrenheit according to The Weather Company.',floor_strike:67,strike_type:'greater',close_time:'2026-10-30T04:00:00Z',yes_ask_dollars:'.90',yes_ask_size_fp:'10'};
  const event={event_ticker:'KXHIGHCHI-26OCT29',category:'Climate and Weather',title:'Highest temperature in Chicago today?',settlement_sources:[{name:'The Weather Company'}],markets:[market]};
  const kalshi=async path=>{
    if(path.startsWith('/series?'))return {series:[{ticker:'KXHIGHCHI',title:'Highest temperature in Chicago'}]};
    if(path.startsWith('/events?'))return {events:[event]};
    if(path==='/markets/CHI-HIGH'){reads++;return {market}};
    throw Error(path);
  };
  const twc=async path=>path.startsWith('/api/climate/primary?')?{results:[{station:{cliId:'MDW',icao:'KMDW',timezone:'America/Chicago'},status:'no_report',data:null}]}:
    {source:'live',fetchedAt:'2026-10-30T03:15:00Z',stations:[{icaoId:'KMDW',timezone:'America/Chicago',observations:[{icaoId:'KMDW',localDate:'2026-10-29',reportTimeUTC:'2026-10-29T20:00:00Z',tempF:70,status:'settled'}]}]};
  const stats=await scanWeatherMarkets({kalshi,nws:async()=>{throw Error('NWS is not the settlement source')},twc,now:()=>new Date(time),pause:async ms=>{time+=ms},onVerified:async x=>verified.push(...x)});
  assert.equal(stats.eligible,1);assert.equal(stats.verified,1);assert.equal(reads,2);
  assert.equal(verified[0].secondAt-verified[0].firstAt,3000);
  assert.equal(verified[0].observed.source,'The Weather Company');assert.equal(verified[0].observed.icao,'KMDW');
  assert.equal(stats.companyProbe.available,true);
  assert.equal(stats.companyObservationFeed.available,true);
  const below=await scanWeatherMarkets({kalshi,nws:async()=>{throw Error('wrong source')},twc:async path=>{
    const data=await twc(path);
    return path.startsWith('/api/metar?')?{...data,stations:data.stations.map(s=>({...s,observations:s.observations.map(o=>({...o,tempF:67}))}))}:data;
  },now:()=>new Date(time),pause:async ms=>{time+=ms},onVerified:async()=>{throw Error('not crossed')}});
  assert.equal(below.rejections.thresholdNotCrossed,1);
});

