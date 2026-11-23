import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedScannerSport,isScannerExcludedSport,discoverCurrentMilestones,
  refreshDiscovery,scanMilestones,eligibleForMarkets,nearEntryPhase,entryEventTickers,
  winnerEventTickers,prioritizeMarketGames,readyOverTickets} from '../src/discovery.mjs';
const now=Date.parse('2026-11-20T18:00:00Z');
const milestone=(id,type,league)=>({id,type,title:'Home vs Away',start_date:new Date(now-300000).toISOString(),
 details:{league,main_game_event_ticker:'KX'+({NBA:'NBA',WNBA:'WNBA',NCAAMB:'NCAAMB',NCAAWB:'NCAAWB',NHL:'NHL','Finland Liiga':'LIIGA',Soccer:'EPL',NFL:'NFL',CFB:'NCAAFB'}[league]||'OTHER')+'GAME-TEST'}});
const disabledBasketball=[['basketball','basketball_game','NBA'],['wnba','basketball_game','WNBA'],
 ['college-men','basketball_game','NCAAMB'],['college-women','basketball_game','NCAAWB']];
const enabled=[['hockey','hockey_match','NHL'],['hockey-eu','hockey_match','Finland Liiga'],
 ['soccer','soccer_tournament_multi_leg','Soccer'],['football','football_game','NFL'],['college-football','football_game','CFB']];
const disabled=[...disabledBasketball,['baseball','baseball_game','MLB'],['tennis','tennis_match','ATP'],
 ['table-tennis','table_tennis_match','Table tennis'],['cricket','cricket_match','ODI (M)'],
 ['golf','golf_tournament','Golf'],['darts','darts_match','Darts'],
 ['rugby','rugby_match','Rugby'],['handball','handball_match','Handball'],
 ['lacrosse','lacrosse_match','Lacrosse'],['volleyball','volleyball_match','Volleyball'],
 ['esports','esports_match','Soccer']];
const state=m=>({id:m.id,type:m.type,sport:['NCAAMB','NCAAWB'].includes(m.details.league)?m.details.league==='NCAAMB'?'NCAAB':'NCAAW':m.details.league,
 verifiedLive:true,scoreKnown:true,period:3,remainingSeconds:100,homeUnits:3,awayUnits:1});

test('only hockey, soccer and football can enter active scanner family or trade market',()=>{
 for(const [id,type,league] of enabled){const m=milestone(id,type,league),s=state(m);
  assert.equal(isScannerExcludedSport(m),false,id);
  assert.equal(supportedScannerSport(m),true,id);
  if(id!=='hockey-eu')assert.equal(eligibleForMarkets(s),true,id);
  assert.ok(entryEventTickers(m,s).length>0,id);
 }
 for(const [id,type,league] of disabled){const m=milestone(id,type,league),s=state(m);
  assert.equal(isScannerExcludedSport(m),true,id);
  assert.equal(supportedScannerSport(m),false,id);
  assert.equal(eligibleForMarkets(s),false,id);
  assert.equal(nearEntryPhase(s),false,id);
  assert.deepEqual(entryEventTickers(m,s),[],id);
  assert.deepEqual(winnerEventTickers(m),[],id);
 }
});
test('only the three enabled sports survive new discovery, cached discovery and recently-live preservation',async()=>{
 const all=[...enabled,...disabled].map(([id,type,league])=>milestone(id,type,league));
 const valid=enabled.map(([id])=>id);
 assert.deepEqual((await discoverCurrentMilestones(async()=>({milestones:all}),now)).map(m=>m.id),valid);
 assert.deepEqual(scanMilestones(all,new Set(all.map(m=>m.id)),now).map(m=>m.id),valid);
 assert.deepEqual((await refreshDiscovery(async()=>({milestones:all}),
  {milestones:all,full_discovered_at:new Date(now-60000).toISOString()},now)).milestones.map(m=>m.id),valid);
});
test('even held or signaled games from removed sports never enter market priority or active verification watches',()=>{
 const all=[...enabled,...disabled].map(([id,type,league])=>milestone(id,type,league));
 const games=all.map(m=>({milestone:m,state:state(m),watchable:true}));
 const ids=new Set(all.map(m=>m.id));
 assert.deepEqual(new Set(prioritizeMarketGames(games,{heldIds:ids,signaledIds:ids,lowBudget:999}).map(x=>x.milestone.id)),
  new Set(enabled.map(([id])=>id)));
 const rows=all.map(m=>({milestone:m,signals:[{strategy:'over',ticker:m.id+'-OVER',ask:'.87',ask_size:'2',execution:'Awaiting score verification'}]}));
 assert.deepEqual(readyOverTickets(rows).map(x=>x.milestone.id),enabled.map(([id])=>id));
});