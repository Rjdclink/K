import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {supportedScannerSport,isScannerExcludedSport,eligibleForMarkets,scanMilestones,
  discoverCurrentMilestones,refreshDiscovery,nearEntryPhase,prioritizeMarketGames,
  entryEventTickers,winnerEventTickers,readyOverTickets} from '../src/discovery.mjs';

const excluded=[['cricket_match','Cricket'],['darts_match','Darts'],
  ['golf_tournament','Golf'],['table_tennis_match','Table tennis'],
  ['baseball_game','MLB'],['tennis_match','ATP'],['rugby_match','Rugby'],
  ['handball_match','Handball'],['lacrosse_match','Lacrosse'],['volleyball_match','Volleyball']];
const eligible=[['soccer_match','Soccer'],['hockey_match','NHL'],
  ['basketball_game','NBA'],['football_game','NFL']];
const idFor=type=>'KX'+type.toUpperCase().replace(/\W/g,'')+'GAME-EXAMPLE';
const milestone=(type,sport,now=Date.now())=>({id:type,title:'Home vs Away',type,sport,
  start_date:new Date(now-3600000).toISOString(),
  details:{league:sport,main_game_event_ticker:idFor(type)},
  related_event_tickers:[idFor(type)]});
const state=(type,sport)=>({id:type,type,sport,verifiedLive:true,scoreKnown:true,
  period:3,remainingSeconds:90,homeUnits:3,awayUnits:1,
  golf:{board:[{current_round_thru:18}]},cricket:{innings:2,ballsRemaining:8},
  tableTennis:{bestOf:5,setNumber:5},darts:{firstLegs:5,secondLegs:2}});

test('all four sports have zero automatic discovery, score, market and priority eligibility',()=>{
  for(const [type,sport] of excluded){
    const m=milestone(type,sport),s=state(type,sport);
    assert.equal(isScannerExcludedSport(m),true,type+' excluded milestone');
    assert.equal(isScannerExcludedSport(s),true,type+' excluded state');
    assert.equal(supportedScannerSport(m),false,type+' milestone');
    assert.equal(supportedScannerSport(s),false,type+' state');
    assert.equal(eligibleForMarkets(s),false,type+' market');
    assert.equal(nearEntryPhase(s),false,type+' fast-pass priority');
    assert.deepEqual(entryEventTickers(m,s),[],type+' entry tickers');
    assert.deepEqual(winnerEventTickers(m),[],type+' winner tickers');
  }
  for(const [type,sport] of eligible){
    const m=milestone(type,sport),s=state(type,sport);
    assert.equal(isScannerExcludedSport(m),false,type+' must remain supported');
    assert.equal(supportedScannerSport(m),true,type+' preserved');
    assert.equal(eligibleForMarkets(s),true,type+' market preserved');
    assert.ok(entryEventTickers(m,s).includes(idFor(type)),type+' market ticker preserved');
  }
});

test('excluded sports disappear from fresh discovery, cached discovery and recently-live retained milestones',async()=>{
  const now=Date.parse('2026-11-20T16:40:00Z');
  const all=[...excluded,...eligible].map(([type,sport])=>milestone(type,sport,now));
  const activeIds=eligible.map(([type])=>type);
  const get=async()=>({milestones:all,cursor:''});
  const fresh=await discoverCurrentMilestones(get,now);
  assert.deepEqual(fresh.map(m=>m.id),activeIds);
  const recent=new Set(all.map(m=>m.id));
  assert.deepEqual(scanMilestones(all,recent,now).map(m=>m.id),activeIds);
  const cached=await refreshDiscovery(get,{milestones:all,
    full_discovered_at:new Date(now-60_000).toISOString()},now);
  assert.deepEqual(cached.milestones.map(m=>m.id),activeIds);
});

test('excluded sports cannot reenter urgent/held market queues or cached ready-overs',()=>{
  const all=[...excluded,...eligible].map(([type,sport])=>({
    milestone:milestone(type,sport),state:state(type,sport),watchable:true}));
  const ids=new Set(all.map(g=>g.milestone.id));
  const chosen=prioritizeMarketGames(all,{signaledIds:ids,heldIds:ids,lowBudget:100});
  assert.deepEqual(new Set(chosen.map(g=>g.milestone.id)),new Set(eligible.map(([type])=>type)));
  const tickets=all.map(({milestone})=>({milestone,signals:[{
    strategy:'over',ticker:milestone.id+'-T',ask:'.95',ask_size:'10',
    execution:'Awaiting score verification'}]}));
  assert.deepEqual(readyOverTickets(tickets).map(item=>item.milestone.id),
    eligible.map(([type])=>type));
});

test('live dashboard and clock refresh exclude removed sports while historical filled positions remain reportable',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const dashboard=src.slice(src.indexOf('async function state(){'));
  const clocks=src.slice(src.indexOf('async function refreshOpenClocks(){'),
    src.indexOf('async function state(){'));
  const scan=src.slice(src.indexOf('async function scan(cachedMilestones'),
    src.indexOf('async function refreshOpenClocks(){'));
  assert.match(dashboard,/sport_family ~\* '\^\(basketball\|hockey\|soccer\|football\)_'/);
  assert.match(clocks,/sport_family ~\* '\^\(basketball\|hockey\|soccer\|football\)_'/);
  assert.match(scan,/ms=scanMilestones\(refreshed\.milestones,/);
  assert.match(scan,/refreshStaleMilestones\(ms\)/);
  assert.match(src,/function checkCurrentHeldCombinations[\s\S]*?isScannerExcludedSport\(/);
  assert.match(src,/async function exitComebacks[\s\S]*?isScannerExcludedSport\(/);
  for(const [from,to,label] of [
    ['async function watchCorrectedOvers(','async function watchLeadWindows(','corrected-over watch'],
    ['async function watchLeadWindows(','async function watchReadyOverTickets(','fast winner watch'],
    ['async function watchReadyOverTickets(','async function scanOfficialMentions(','fast over watch']
  ]){
    const region=src.slice(src.indexOf(from),src.indexOf(to));
    assert.match(region,/sport_family ~\* '\^\(basketball\|hockey\|soccer\|football\)_'/,label);
  }
  const cron=src.slice(src.indexOf("if(req.method==='POST'&&(url.pathname==='/tick'||url.pathname==='/tick/discovery'))"),
    src.indexOf("if(req.method==='GET'&&url.pathname==='/login')"));
  assert.match(cron,/g.sport_family ~\* '\^\(basketball\|hockey\|soccer\|football\)_'/,
    'cached cron live-game list must not reintroduce disabled sports');
  assert.match(dashboard,/WHERE a.status='filled'/,
    'historical confirmed fills must remain visible in the positions card');
});