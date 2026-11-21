import test from 'node:test';import assert from 'node:assert/strict';
import {externalScoresQualify,playerValueQualifies} from '../src/external_values.mjs';
const g={id:'test',home:115,away:102,homeName:'Home',awayName:'Away',homeTeamId:'home',awayTeamId:'away'};
const over={event_ticker:'KXNBATOTAL-TEST',floor_strike:214.5,title:'Over 214.5 total points'};
const lead={event_ticker:'KXNBAGAME-TEST',title:'Home wins',custom_strike:{basketball_team:'home'},rules_primary:'Home wins'};
test('an external OVER score below Kalshi can still clear contract, and one above Kalshi cannot bypass line',()=>{
 assert.equal(externalScoresQualify(g,{home:112,away:103},over),true,'external 215 clears line despite Kalshi 217');
 assert.equal(externalScoresQualify({...g,home:109,away:100},{home:105,away:104},over),false,'Kalshi is lower but external 209 fails contract');
});
test('a commanding winner is determined by external margin rather than Kalshi margin',()=>{
 assert.equal(externalScoresQualify(g,{home:100,away:99},lead,{minimumMargin:16}),false);
 assert.equal(externalScoresQualify(g,{home:116,away:99},lead,{minimumMargin:16}),true);
 assert.equal(externalScoresQualify({...g,home:100,away:119},{home:120,away:90},lead,{minimumMargin:16}),true);
});
test('independent countable player stat can qualify even if Kalshi reports fewer, but removable cushion still applies',()=>{
 assert.equal(playerValueQualifies(9,{value:8,line:7.5}),true);
 assert.equal(playerValueQualifies(8,{value:9,line:7.5}),false);
});
