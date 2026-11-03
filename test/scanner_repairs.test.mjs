import test from 'node:test';
import assert from 'node:assert/strict';
import {espnMatches,verifyIndependentOverDecision,verifySportradarOver} from '../src/score_verification.mjs';
import * as discovery from '../src/discovery.mjs';
import * as orderbook from '../src/orderbook.mjs';
import {createExecutionAudit} from '../src/execution_audit.mjs';

const start='2026-11-02T22:00:00Z';
const milestone={title:'USC Upstate at Wake Forest',start_date:start};
const game={sport:'NCAAW',type:'basketball_game',homeName:'Wake Forest',awayName:'USC Upstate',
  home:60,away:53,period:4,remainingSeconds:101,scoreKnown:true};
const market={event_ticker:'KXNCAAWBTOTAL-X',floor_strike:100.5};
const teams=[{homeAway:'home',score:'60',team:{id:'154',location:'Wake Forest',name:'Demon Deacons',displayName:'Wake Forest Demon Deacons',shortDisplayName:'Wake Forest',abbreviation:'WAKE'}},
  {homeAway:'away',score:'53',team:{id:'2908',location:'South Carolina Upstate',name:'Spartans',displayName:'South Carolina Upstate Spartans',shortDisplayName:'SC Upstate',abbreviation:'UPST'}}];
const board={events:[{id:'401906102',date:start,competitions:[{competitors:teams,status:{period:4,displayClock:'1:41',type:{state:'in'}}}]}]};
const reply=data=>({ok:true,status:200,headers:new Headers(),json:async()=>data});

test('college ESPN queries include the full group and tolerate the observed school alias',async()=>{
  const calls=[];
  assert.equal(await verifyIndependentOverDecision({...game},milestone,{market,sportradarApiKey:'test-only',fetcher:async url=>{
    calls.push(url);assert.ok(url.includes('espn.com'));
    return reply(new URL(url).searchParams.get('groups')==='50'?board:{events:[]});
  }}),true);
  assert.equal(calls.length,2,'adjacent date lookups, no provider retry or fallback');
  assert.equal(espnMatches(board,{...game,awayName:'South Carolina'},milestone).length,0);
  assert.equal(espnMatches(board,{...game,awayName:'USC'},milestone).length,0);
  assert.equal(espnMatches(board,game,{...milestone,start_date:'2026-11-01T22:00:00Z'}).length,0);
  assert.equal(espnMatches(board,{...game,homeName:game.awayName,awayName:game.homeName},milestone).length,0);
});

test('college school locations and trailing St. aliases match without merging State with the other school',()=>{
  const b=structuredClone(board);b.events[0].competitions[0].competitors[1].team={location:'Georgia State',name:'Panthers',displayName:'Georgia State Panthers'};
  assert.equal(espnMatches(b,{...game,awayName:'Georgia St.'},milestone).length,1);
  assert.equal(espnMatches(b,{...game,awayName:'Georgia'},milestone).length,0);
  assert.equal(espnMatches(b,{...game,sport:'NBA',awayName:'Georgia St.'},milestone).length,0);
});

test('Sportradar resolves school and mascot names by provider team ID and caches only identity metadata',async()=>{
  const id='ccc1a514-3851-4d1b-9869-e0a141245bbc';
  const h={id:'home-id',name:'Wake Forest Demon Deacons',alias:'WAKE'},a={id:'away-id',name:'USC Upstate Spartans',alias:'SCUS'};
  const fixture={id,scheduled:start,home:h,away:a};
  const hierarchyCache=new Map(),calls=[];
  let duplicate=false,final=false,wrongId=false;
  const run=()=>verifySportradarOver({...game},milestone,{market,sportradarApiKey:'test-only',minInterval:0,hierarchyCache,fetcher:async url=>{
    calls.push(url);
    if(url.endsWith('schedule.json'))return reply({games:duplicate?[fixture,{...fixture,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}]:[fixture]});
    if(url.endsWith('hierarchy.json'))return reply({conferences:[{teams:[{...h,market:'Wake Forest',name:'Demon Deacons'},{...a,market:'USC Upstate',name:'Spartans'}]}]});
    return reply({...fixture,status:final?'closed':'inprogress',quarter:4,clock:'1:41',home:{...h,id:wrongId?'unrelated':h.id,points:60},away:{...a,points:53}});
  }});
  assert.equal(await run(),true);assert.equal(await run(),true);
  assert.equal(calls.filter(u=>u.endsWith('hierarchy.json')).length,1);
  assert.equal(calls.filter(u=>u.endsWith('summary.json')).length,2,'live scores are not cached with identity metadata');
  duplicate=true;assert.equal(await run(),false);duplicate=false;
  final=true;assert.equal(await run(),false);final=false;
  wrongId=true;assert.equal(await run(),null);
});

test('incremental discovery preserves old tournaments and periodically reconciles the full catalog',async()=>{
  const now=Date.parse('2026-11-03T00:00:00Z'),old={id:'golf',type:'golf_tournament',start_date:'2026-10-30T12:00:00Z'};
  const fresh={id:'new',start_date:'2026-11-02T23:00:00Z'},queries=[];
  const get=async url=>{queries.push(new URL(url,'https://test').searchParams);return {milestones:[fresh]}};
  const previous={milestones:[old,{id:'expired',start_date:'2026-11-02T22:00:00Z'}],full_discovered_at:new Date(now-60000).toISOString()};
  const recent=await discovery.refreshDiscovery(get,previous,now);
  assert.deepEqual(recent.milestones.map(m=>m.id),['golf','new']);
  assert.ok(queries.every(q=>q.get('minimum_start_date')==='2026-11-02T16:00:00.000Z'));
  queries.length=0;
  const full=await discovery.refreshDiscovery(get,previous,now+15*60000);
  assert.deepEqual(full.milestones.map(m=>m.id),['new']);
  assert.ok(queries.every(q=>q.get('minimum_start_date')==='2026-10-27T00:15:00.000Z'));
  assert.equal(full.full_discovered_at,'2026-11-03T00:15:00.000Z');
});

test('missing-ask cooldown is shared across callers and clears on a positive book or failure',async()=>{
  let now=0;const slots=new Map();
  const query=async(sql,args)=>{
    if(sql.startsWith('CREATE'))return {};
    if(sql.startsWith('INSERT')){
      const [tickers,token]=args,rows=[];
      for(const ticker of tickers)if(!slots.has(ticker)||slots.get(ticker).until<=now){slots.set(ticker,{token,until:now+10000});rows.push({market_ticker:ticker})}
      return {rows};
    }
    const [token,empty,tickers]=args;
    for(const ticker of tickers)if(slots.get(ticker)?.token===token)slots.set(ticker,{token,until:now+(empty.includes(ticker)?10000:0)});
    return {};
  };
  const one=orderbook.createMissingAskProbe(query),two=orderbook.createMissingAskProbe(query);
  let reads=0;const empty=async tickers=>{reads++;return new Map(tickers.map(t=>[t,null]))};
  await Promise.all([one(['A','A'],empty),two(['A'],empty)]);assert.equal(reads,1);
  now=9999;await two(['A'],empty);assert.equal(reads,1);
  now=10000;await two(['A'],empty);assert.equal(reads,2);
  await one(['B'],async()=>new Map([['B',{price:.96,size:2}]]));
  await two(['B'],empty);assert.equal(reads,3,'positive quote does not start empty-book cooldown');
  await assert.rejects(one(['C'],async()=>{throw Error('network failure')}),/network failure/);
  await two(['C'],empty);assert.equal(reads,4,'failed requests are not cached as empty books');
});

test('failed orderbook requests remain distinguishable from confirmed empty books',async()=>{
  const result=await orderbook.bestAsksForTickers(['empty','failed'],async()=>[{ticker:'empty',orderbook_fp:{no_dollars:[]}}],async()=>{throw Error('unavailable')});
  assert.equal(result.get('empty'),null);assert.equal(result.get('failed'),undefined);
});

test('decision audit appends history even for delayed decisions and includes soccer timing',async()=>{
  const calls=[];const record=createExecutionAudit(async(...args)=>calls.push(args));
  const d={source:'scan',market:{ticker:'M'},signal:{strategy:'lead'},game:{id:'G',soccerMinute:100,matchRemainingSeconds:45},stage:'entry_rule'};
  await record({...d,startedAt:2000});await record({...d,startedAt:1000});
  assert.match(calls[0][0],/CREATE TABLE IF NOT EXISTS execution_decision_history/);
  for(const [sql,args] of calls.slice(1)){
    assert.match(sql,/INSERT INTO execution_decision_history/);
    assert.match(sql,/checked_at<=EXCLUDED.checked_at/);
    assert.equal(JSON.parse(args[8]).soccerMinute,100);
    assert.equal(JSON.parse(args[8]).matchRemainingSeconds,45);
  }
});
