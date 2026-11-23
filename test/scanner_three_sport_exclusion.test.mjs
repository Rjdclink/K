import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  isScannerExcludedSport,supportedScannerSport,entryEventTickers,
  readyOverTickets,scanMilestones,discoverCurrentMilestones,refreshDiscovery
} from '../src/discovery.mjs';
const now=Date.parse('2026-11-23T01:00:00Z');
const linked=(type,sport,events)=>({id:type+'-'+sport,title:sport+' fixture',type,sport,
  details:{league:sport,main_game_event_ticker:events[0]},
  related_event_tickers:events,start_date:new Date(now-3600000).toISOString()});

test('only hockey, soccer and football are within scanner discovery, including cached fixtures',async()=>{
 for(const [type,sport] of [['basketball_game','NBA'],['basketball_game','WNBA'],['basketball_game','NCAAB'],
  ['basketball_game','NCAAW'],['basketball_game','China CBA'],['esports_match','eBasketball']]){
  const m=linked(type,sport,['KXNBAGAME-26NOV23']);
  assert.equal(isScannerExcludedSport(m),true,sport);
  assert.equal(supportedScannerSport(m),false,sport);
 }
 for(const [type,sport] of [['hockey_match','NHL'],['soccer_match','Soccer'],
  ['football_game','NFL'],['football_game','CFB']]){
   assert.equal(supportedScannerSport(linked(type,sport,['KXNFLGAME-26NOV23'])),true,sport);
 }
 const fixtures=[
  linked('basketball_game','NBA',['KXNBAGAME-26NOV23']),
  linked('hockey_match','NHL',['KXNHLGAME-26NOV23']),
  linked('soccer_match','Soccer',['KXEPLGAME-26NOV23']),
  linked('football_game','NFL',['KXNFLGAME-26NOV23'])
 ];
 const get=async()=>({milestones:fixtures,cursor:null});
 const discovered=await discoverCurrentMilestones(get,now);
 assert.deepEqual(discovered.map(x=>x.sport),['NHL','Soccer','NFL']);
 assert.equal(scanMilestones(fixtures,new Set(),now).length,3);
 const refreshed=await refreshDiscovery(get,{milestones:fixtures,full_discovered_at:new Date(now-30000).toISOString()},now);
 assert.deepEqual(refreshed.milestones.map(x=>x.sport),['NHL','Soccer','NFL']);
});

test('scanner market discovery includes regular totals/winners but excludes all player-prop series even on held games',()=>{
 const m=linked('football_game','NFL',[
  'KXNFLGAME-26NOV23ABC','KXNFLTOTAL-26NOV23ABC',
  'KXNFLTEAMTOTAL-26NOV23ABC','KXNFLPASSYDS-26NOV23ABC','KXNFLRECYDS-26NOV23ABC',
  'KXNFLRUSHYDS-26NOV23ABC','KXNFLRECPROT-26NOV23ABC',
  'KXNFLPASSTDS-26NOV23ABC'
 ]);
 const state={type:'football_game',sport:'NFL',period:3,remainingSeconds:900};
 const e=entryEventTickers(m,state);
 assert.ok(e.some(x=>x.startsWith('KXNFLGAME-')));
 assert.ok(e.some(x=>x.startsWith('KXNFLTOTAL-')));
 assert.ok(e.some(x=>x.startsWith('KXNFLTEAMTOTAL-')));
 for(const series of ['PASSYDS','RECYDS','RUSHYDS','RECPROT','PASSTDS'])
  assert.ok(!e.some(x=>x.startsWith('KXNFL'+series+'-')),series);
 const h=linked('hockey_match','NHL',['KXNHLGAME-26NOV23ABC','KXNHLGOALS-26NOV23ABC',
  'KXNHLSAVES-26NOV23ABC','KXNHLTOTAL-26NOV23ABC']);
 const hockeyEvents=entryEventTickers(h,{type:'hockey_match',sport:'NHL',period:2,remainingSeconds:400});
 assert.ok(hockeyEvents.some(x=>x.startsWith('KXNHLTOTAL-')));
 assert.ok(!hockeyEvents.some(x=>x.startsWith('KXNHLGOALS-')));
 assert.ok(!hockeyEvents.some(x=>x.startsWith('KXNHLSAVES-')));
 assert.deepEqual(entryEventTickers(linked('basketball_game','NBA',['KXNBAGAME-26NOV23ABC']),
  {type:'basketball_game',sport:'NBA'}),[]);
});

test('persisted player-prop OVER signals are not revived by urgent fast scanning',()=>{
 const m=linked('football_game','NFL',['KXNFLGAME-26NOV23ABC']);
 const rows=[{milestone:m,signals:[
  {strategy:'over',ticker:'KXNFLRECYDS-26NOV23ABC-PLAYER',ask:'.9',ask_size:'5',execution:'Awaiting score verification'},
  {strategy:'over',ticker:'KXNFLTOTAL-26NOV23ABC-45',ask:'.9',ask_size:'5',execution:'Awaiting score verification'}]}];
 const results=readyOverTickets(rows,12);
 assert.deepEqual(results.map(x=>x.signal.ticker),['KXNFLTOTAL-26NOV23ABC-45']);
 assert.deepEqual(readyOverTickets([{milestone:linked('basketball_game','NBA',['KXNBAGAME-26NOV23ABC']),
  signals:[{strategy:'over',ticker:'KXNBATOTAL-26NOV23ABC-200',ask:'.9',ask_size:'5',execution:'Awaiting score verification'}]}]),[]);
});

test('live scanner does not read or update player prop windows or actively poll basketball',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const scan=src.slice(src.indexOf('async function scan(cachedMilestones,discoveryCount)'),src.indexOf('async function refreshOpenClocks()'));
 const promote=src.slice(src.indexOf('async function promoteScanGames('),src.indexOf('async function scanNearPriorityGames('));
 const clock=src.slice(src.indexOf('async function refreshOpenClocks()'),src.indexOf('async function state()'));
 const dashboard=src.slice(src.indexOf('async function state()'),src.indexOf('async function settlementAlerts('));
 assert.doesNotMatch(scan,/ensurePropWindows\(|FROM player_prop_windows|INTO player_prop_windows|DELETE FROM player_prop_windows/);
 assert.doesNotMatch(promote,/player_prop_windows|ensurePropWindows\(/);
 assert.doesNotMatch(scan,/noOnlyBasketballGames|noOnlyEvents|collegeBasketballGames|collegeBasketballEvents/);
 assert.match(scan,/marketMap\(marketGames\.flatMap\(g=>entryEventTickers\(g\.milestone,g\.state\)\)\)/);
 assert.doesNotMatch(scan,/crossingRows|propWatchIds|basketballNoSignals/);
 assert.doesNotMatch(clock,/\^\(basketball\|hockey\|soccer\|football\)_/);
 assert.doesNotMatch(dashboard,/\^\(basketball\|hockey\|soccer\|football\)_/);
 assert.match(src,/g\.sport_family ~\* '\^\(hockey\|soccer\|football\)_'/);
});
