import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {espnMatches,verifyIndependentOverDecision} from '../src/score_verification.mjs';
const fixture=JSON.parse(readFileSync(new URL('fixtures/wmu-espn.json',import.meta.url),'utf8'));
test('captured Western Michigan fixture matches its exact ESPN college location alias',()=>{
  const matches=espnMatches(fixture.espn,fixture.game,fixture.milestone);
  assert.equal(matches.length,1);assert.equal(matches[0].eventId,'401866452');
  assert.equal(matches[0].live,true);assert.equal(matches[0].clockOk,true);
  assert.deepEqual([matches[0].home,matches[0].away],[20,10]);
  assert.equal(espnMatches(fixture.espn,{...fixture.game,homeName:'Michigan'},fixture.milestone).length,0);
  assert.equal(espnMatches(fixture.espn,{...fixture.game,sport:'NFL'},fixture.milestone).length,0,'location alias is CFB only');
  assert.equal(espnMatches(fixture.espn,fixture.game,{...fixture.milestone,start_date:'2026-10-30T16:00:00Z'}).length,0);
});
test('a CFB alias does not bypass conflicting scores or ambiguous fixture checks',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>fixture.espn});
  assert.equal(await verifyIndependentOverDecision({...fixture.game},fixture.milestone,{fetcher}),true);
  assert.equal(await verifyIndependentOverDecision({...fixture.game,home:21},fixture.milestone,{fetcher}),false);
  const duplicate={events:[...fixture.espn.events,{...fixture.espn.events[0],id:'other-fixture'}]};
  assert.equal(await verifyIndependentOverDecision({...fixture.game},fixture.milestone,{fetcher:async()=>({ok:true,json:async()=>duplicate})}),false);
});
test('FCS external checks request the FCS scoreboard instead of the default FBS subset',async()=>{
  const milestone={...fixture.milestone,details:{division:'FCS'}},urls=[];
  const fetcher=async url=>{
    urls.push(url);
    return {ok:true,json:async()=>new URL(url).searchParams.get('groups')==='81'?fixture.espn:{events:[]}};
  };
  assert.equal(await verifyIndependentOverDecision({...fixture.game},milestone,{fetcher}),true);
  assert.equal(urls.length,1);
  assert.equal(new URL(urls[0]).searchParams.get('groups'),'81');
});
test('unknown college football divisions cover both groups while retaining contradiction and ambiguity vetoes',async()=>{
  const urls=[];
  const fetcher=async url=>{
    urls.push(url);
    return {ok:true,json:async()=>new URL(url).searchParams.get('groups')==='81'?fixture.espn:{events:[]}};
  };
  assert.equal(await verifyIndependentOverDecision({...fixture.game},fixture.milestone,{fetcher}),true);
  assert.deepEqual(urls.map(url=>new URL(url).searchParams.get('groups')).sort(),['80','81']);
  assert.equal(await verifyIndependentOverDecision({...fixture.game,home:21},fixture.milestone,{fetcher}),false);
});
