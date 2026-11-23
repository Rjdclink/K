import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {page} from '../src/ui.mjs';
import {upcomingScannedGames} from '../src/dashboard_upcoming.mjs';

const now=Date.parse('2026-11-23T00:58:00Z');
const item=(id,type,status,startsInMinutes,league='NHL')=>({
  id,title:id,type,start_date:new Date(now+startsInMinutes*60000).toISOString(),
  details:{status,league}
});

test('found eligible scheduled games appear before there are live scores, without authorizing any trade',()=>{
  const events=[
    item('nhl','hockey_match','scheduled',2,'NHL'),
    item('nfl','football_game','scheduled',22,'NFL'),
    item('mls','soccer_tournament_multi_leg','not_started',32,'MLS'),
    item('ahl','hockey_tournament','unplayed',12,'AHL'),
    item('nba','basketball_game','scheduled',10,'NBA'),
    item('prop','hockey_player_points','scheduled',15,'NHL'),
    item('live','football_game','inprogress',-5,'NFL'),
    item('final','soccer_tournament_multi_leg','final',-4,'MLS'),
    item('stale','hockey_match','scheduled',-300,'NHL'),
    item('far','hockey_match','scheduled',26*60,'NHL'),
  ];
  const projected=upcomingScannedGames(events,{now,excludeIds:new Set(['ahl'])});
  assert.deepEqual(projected.map(g=>g.id),['live','nhl','nfl','mls']);
  assert.equal(projected[0].status,'awaiting');
  assert.equal(projected[1].sport,'NHL');
  assert.equal(projected[1].sport_family,'hockey_match');
  assert.equal(projected[1].status,'scheduled');
  assert.equal(projected[1].start_time,'2026-11-23T01:00:00.000Z');
  assert.deepEqual(projected[0].signals,[]);
  assert.equal(projected[0].home,null);
  assert.equal(projected[0].away,null);
});

test('fixtures awaiting live score near listed kickoff stay visible briefly, not indefinitely',()=>{
  const projected=upcomingScannedGames([
    item('just-started','football_game','scheduled',-10,'NFL'),
    item('too-old','football_game','scheduled',-420,'NFL'),
    item('bad-date','football_game','scheduled',5,'NFL'),
  ].map(m=>m.id==='bad-date'?{...m,start_date:'unparseable'}:m),{now});
  assert.deepEqual(projected.map(g=>g.id),['just-started']);
});

test('dashboard renders upcoming fixtures and a nonzero found count when no live game is active',async()=>{
  const elements=new Map(),element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},
    addEventListener(){},setAttribute(){},append(...args){this.children.push(...args)},
    replaceChildren(...args){this.children=args}});
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},
    createElement:element,querySelectorAll(){return []}};
  const state={games:[],upcoming:upcomingScannedGames([
    item('Chicago at Vancouver','hockey_match','scheduled',2,'NHL'),
    item('MIN Vikings at SF 49ers','football_game','scheduled',22,'NFL')
  ],{now}),orders:[],alerts:[],scan:{discovered:76}};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},
    localStorage:{getItem(){return null}},fetch:async()=>({ok:true,status:200,json:async()=>state}),
    AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('gamesCount').textContent,2);
  assert.equal(elements.get('liveCount').textContent,0);
  assert.equal(elements.get('upcomingCount').textContent,2);
  assert.equal(elements.get('games').children.length,2);
  assert.match(elements.get('games').children[0].children[1].textContent,/Scheduled|Awaiting confirmed/i);
  assert.equal(elements.get('askCount').textContent,0);
});

test('the dashboard never hides a recently scanned live game just because its position is held',()=>{
  const source=page.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
  assert.doesNotMatch(source,/x\.games\.filter\(y=>[^;]*held\.has\(y\.id\)/,
    'a filled order must not remove its sport from the Games found list');
});

test('games with missing live scores are not incorrectly labeled as having fresh score evidence',()=>{
  const indexSource=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(indexSource,/game\.scoreStale=[^;]*(?:game\.home==null|game\.away==null)/);
});

test('a verified live football game remains visible when the account holds a position in it',async()=>{
 const elements=new Map(),element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},
  addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},
  createElement:element,querySelectorAll(){return []}};
 const state={games:[{id:'football',title:'Live football',sport:'NFL',sport_family:'football_game',home:7,away:3,signals:[],status:'live'}],
   orders:[{game_id:'football',market_ticker:'KXNFLGAME-TEST',strategy:'lead',sport:'NFL',sport_family:'football_game',
   game_title:'Live football',allocated_cents:110,potential_profit_cents:80,new_entry_allowed:false}],
   alerts:[],scan:{discovered:17}};
 const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},
   fetch:async()=>({ok:true,status:200,json:async()=>state}),AbortSignal,URLSearchParams,setInterval(){}});
 vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('gamesCount').textContent,1);
 assert.equal(elements.get('games').children.length,1,'held game score must not disappear from scanner list');
 assert.equal(elements.get('games').children[0].children[0].textContent,'Live football');
});

test('dashboard still renders discovered football games when the account-heavy state request times out',async()=>{
 const elements=new Map(),element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},
  addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},
  createElement:element,querySelectorAll(){return []}};
 const requests=[];
 const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},
  fetch:async url=>{
    requests.push(url);
    if(String(url).startsWith('/api/state'))throw Error('Dashboard request timed out');
    if(String(url).startsWith('/api/games'))return {ok:true,status:200,json:async()=>({games:[],
      upcoming:[{id:'soon-nfl',title:'Football starts soon',sport:'NFL',sport_family:'football_game',
      status:'scheduled',start_time:new Date(Date.now()+3600000).toISOString(),signals:[]}],scan:{discovered:19}})};
    throw Error('Unexpected fetch '+url);
  },AbortSignal,URLSearchParams,setInterval(){}});
 vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(requests.some(url=>String(url).startsWith('/api/games')));
 assert.equal(elements.get('gamesCount').textContent,1);
 assert.equal(elements.get('games').children[0].children[0].textContent,'Football starts soon');
 assert.match(elements.get('error').textContent,/delayed|unavailable|timed out/i);
});
