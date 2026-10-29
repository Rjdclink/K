import test from 'node:test';
import assert from 'node:assert/strict';
import {scanWeatherMarkets} from '../src/weather_scanner.mjs';

test('weather scanner checks the same Kalshi rule twice twenty seconds apart and a matching NWS station',async()=>{
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
  assert.equal(checked[0].secondAt-checked[0].firstAt,20000);
  assert.equal(checked[0].observed.station,'KNYC');
});
