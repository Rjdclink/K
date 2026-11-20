import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureEventCache} from '../src/fixture_event_cache.mjs';
const game={id:'same-game',sport:'Soccer'};
const milestone={id:'same-game',start_date:'2026-11-20T18:00:00Z',details:{league:'Norwegian Eliteserien'}};
function mock(){
 const data=new Map();let creates=0,reads=0,writes=0;
 const query=async(sql,args=[])=>{
  if(sql.startsWith('CREATE TABLE')){creates++;return {rows:[]};}
  const key=args.slice(0,2).join(':');
  if(sql.startsWith('SELECT')){reads++;const entry=data.get(key);return {rows:entry&&entry.kickoff===args[2]&&entry.league===args[3]?[{provider_event_id:entry.id}]:[]};}
  if(sql.startsWith('INSERT')){writes++;if(!data.has(key))data.set(key,{id:args[4],kickoff:args[2],league:args[3]});
    const entry=data.get(key);return {rows:[{provider_event_id:entry.id,kickoff:entry.kickoff,league:entry.league}]};}
  throw Error('Bad query '+sql);
 };
 return {query,data,get creates(){return creates},get reads(){return reads},get writes(){return writes}};
}
test('confirmed provider event ID is durable and cannot silently change for the same game',async()=>{
 const db=mock(),first=createFixtureEventCache(db.query),second=createFixtureEventCache(db.query);
 assert.equal(await first.get(game,milestone,'ESPN'),null);
 assert.equal(await first.put(game,milestone,'ESPN','event-100'),true);
 assert.equal(await second.get(game,milestone,'ESPN'),'event-100');
 assert.equal(await second.put(game,milestone,'ESPN','event-101'),false);
 assert.equal(await second.get(game,milestone,'ESPN'),'event-100');
 assert.equal(await second.put(game,milestone,'FOX Sports','fox-999'),true);
 assert.equal(await first.get(game,milestone,'FOX Sports'),'fox-999');
 assert.equal(db.creates,2);
});
test('a different kickoff, league, game or provider cannot reuse a previous fixture binding',async()=>{
 const db=mock(),cache=createFixtureEventCache(db.query);
 await cache.put(game,milestone,'ESPN','event-100');
 assert.equal(await cache.get(game,{...milestone,start_date:'2026-11-21T18:00:00Z'},'ESPN'),null);
 assert.equal(await cache.get(game,{...milestone,details:{league:'Denmark Superliga'}},'ESPN'),null);
 assert.equal(await cache.get({...game,id:'another-game'},milestone,'ESPN'),null);
 assert.equal(await cache.get(game,milestone,'Unknown source'),null);
 assert.equal(await cache.put(game,milestone,'ESPN',''),false);
});