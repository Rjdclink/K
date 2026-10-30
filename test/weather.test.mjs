import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherContract,observedWeather,observedWeatherCompany,weatherDate,weatherStationId,stationTimezone} from '../src/weather.mjs';

const station={id:'KNYC',timezone:'America/New_York'};
const event={event_ticker:'KXRAINDNYC-261102',title:'Rain in New York City on Nov 2, 2026?',category:'Climate and Weather',settlement_sources:[{name:'National Weather Service'}]};
const market={ticker:'KXRAINDNYC-261102-0',status:'active',result:'',rules_primary:'If the total precipitation at Central Park (KNYC) in New York City on Nov 2, 2026 is strictly greater than 0 inches, then the market resolves to Yes.',strike_type:'greater',floor_strike:0,close_time:'2026-11-03T05:00:00Z'};
test('daily weather can enter throughout its current local day before the trading cutoff',()=>{
  const now=new Date('2026-11-03T04:55:00Z');
  const c=weatherContract(event,market,station,now);
  assert.equal(c?.localDate,'2026-11-02');
  assert.equal(c?.end,Date.parse('2026-11-03T05:00:00Z'));
  assert.equal(c?.close,Date.parse('2026-11-03T04:59:00Z'));
  assert.equal(weatherContract(event,market,station,new Date('2026-11-02T04:59:59Z')),null);
  assert.ok(weatherContract(event,market,station,new Date('2026-11-02T05:00:00Z')));
  assert.ok(weatherContract(event,market,station,new Date('2026-11-02T18:00:00Z')));
  assert.equal(weatherContract(event,market,station,new Date('2026-11-03T04:59:00Z')),null);
  assert.equal(weatherContract(event,market,station,new Date('2026-11-03T05:00:00Z')),null);
  assert.equal(weatherContract({...event,title:'Rain in New York City on Nov 3, 2026?'},market,station,now),null);
  assert.equal(weatherContract(event,{...market,close_time:'2026-11-03T04:54:00Z'},station,now),null);
});
test('DST climate day can extend past midnight, while entry remains on the named local day',()=>{
  const e={...event,title:'Rain in New York City on Oct 29, 2026?'};
  const m={...market,rules_primary:market.rules_primary.replace('Nov 2','Oct 29'),close_time:'2026-10-30T05:00:00Z'};
  assert.equal(weatherContract(e,m,station,new Date('2026-10-29T03:59:59Z')),null);
  assert.ok(weatherContract(e,m,station,new Date('2026-10-29T04:00:00Z')));
  assert.ok(weatherContract(e,m,station,new Date('2026-10-30T01:58:59Z')));
  assert.equal(weatherContract(e,m,station,new Date('2026-10-30T03:55:00Z'))?.end,Date.parse('2026-10-30T05:00:00Z'));
  assert.equal(weatherContract(e,m,station,new Date('2026-10-30T04:55:00Z')),null);
});
test('only a same-station in-period observed exceeded outcome qualifies',()=>{
  const c=weatherContract(event,market,station,new Date('2026-11-03T04:55:00Z'));
  const observation=(stationId,time,mm)=>({properties:{station:`https://api.weather.gov/stations/${stationId}`,timestamp:time,precipitationLastHour:{value:mm}}});
  const now=new Date('2026-11-03T04:55:00Z');
  assert.equal(observedWeather(c,[observation('KNYC','2026-11-03T04:30:00Z',2.54)],now)?.station,'KNYC');
  assert.equal(observedWeather(c,[observation('KLGA','2026-11-03T04:30:00Z',2.54)],now),null);
  assert.equal(observedWeather(c,[observation('KNYC','2026-11-03T05:00:00Z',2.54)],now),null);
  assert.equal(stationTimezone({geometry:{coordinates:[-73.97,40.78]}}),'America/New_York');
});
test('predictive rain, unresolved ranges and wrong source fail closed',()=>{
  const at=new Date('2026-11-03T04:55:00Z');
  assert.equal(weatherContract(event,{...market,strike_type:'less'},station,at),null);
  assert.equal(weatherContract(event,{...market,cap_strike:1},station,at),null);
  assert.equal(weatherContract({...event,settlement_sources:[{name:'Synoptic Data'}]},market,station,at),null);
});
test('Weather Company station and same-day settled observations verify directional temperature only',()=>{
  const at=new Date('2026-10-30T03:15:00Z'),twcStation={id:'CLIMDW',icao:'KMDW',timezone:'America/Chicago'};
  const e={event_ticker:'KXHIGHCHI-26OCT29',title:'Highest temperature in Chicago today?',category:'Climate and Weather',settlement_sources:[{name:'The Weather Company'}]};
  const m={ticker:'KXHIGHCHI-26OCT29-T67',status:'active',result:'',rules_primary:'The maximum temperature recorded at Chicago (CLIMDW) for Oct 29, 2026 is greater than 67 degrees Fahrenheit according to The Weather Company.',strike_type:'greater',floor_strike:67,close_time:'2026-10-30T04:00:00Z'};
  assert.equal(weatherDate(e),'Oct 29, 2026');assert.equal(weatherStationId(m.rules_primary),'CLIMDW');
  const c=weatherContract(e,m,twcStation,at);
  assert.equal(c?.source,'The Weather Company');assert.equal(c?.start,Date.parse('2026-10-29T05:00:00Z'));
  assert.equal(weatherContract(e,m,twcStation,new Date('2026-10-30T04:00:00Z')),null);
  const reading={icaoId:'KMDW',localDate:'2026-10-29',reportTimeUTC:'2026-10-29T20:00:00Z',tempF:70,status:'settled'};
  const feed={source:'live',fetchedAt:at.toISOString(),stations:[{icaoId:'KMDW',timezone:'America/Chicago',observations:[reading]}]};
  assert.equal(observedWeatherCompany(c,feed,at)?.value,70);
  const observation=tempF=>({...feed,stations:[{...feed.stations[0],observations:[{...reading,tempF}]}]});
  assert.equal(observedWeatherCompany(c,observation(68),at)?.value,68,'one full degree past a high line qualifies');
  assert.equal(observedWeatherCompany(c,observation(67.9),at),null);
  const low={...c,type:'low',comparison:'less',threshold:67};
  assert.equal(observedWeatherCompany(low,observation(66),at)?.value,66,'one full degree below a low line qualifies');
  assert.equal(observedWeatherCompany(low,observation(66.1),at),null);
  assert.equal(observedWeatherCompany(c,{...feed,stations:[{...feed.stations[0],observations:[{...reading,status:'preliminary'}]}]},at),null);
  assert.equal(observedWeatherCompany(c,{...feed,stations:[{...feed.stations[0],observations:[{...reading,localDate:'2026-10-28'}]}]},at),null);
  assert.equal(observedWeatherCompany(c,{...feed,stations:[{...feed.stations[0],observations:[{...reading,icaoId:'KORD'}]}]},at),null);
  assert.equal(observedWeatherCompany(c,{forecast:[{tempF:70}]},at),null);
  assert.equal(weatherContract({...e,settlement_sources:[{name:'National Weather Service'}]},m,twcStation,at),null);
  assert.equal(weatherContract(e,{...m,rules_primary:m.rules_primary.replace('CLIMDW','CLIORD')},twcStation,at),null);
  assert.equal(weatherContract(e,{...m,rules_primary:'The total precipitation at CLIMDW in Chicago in Oct 29, 2026 is strictly greater than 0 inches.',floor_strike:0},twcStation,at),null);
});

