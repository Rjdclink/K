import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCAN_TIER_MS,scanTier,priorityAfterPromotion,runScanTierWindow} from '../src/scan_tiers.mjs';

const game=(type,sport,period,seconds,other={})=>({id:'one',type,sport,period,remainingSeconds:seconds,verifiedLive:true,...other});

test('independent intervals: urgent every 10s, near every 30s, discovery every 120s',()=>{
 assert.deepEqual(SCAN_TIER_MS,{fast:10000,near:30000,discovery:120000});
});
test('all four sports promote to fast tier by clock proximity without trusting Kalshi goals',()=>{
 for(const item of [
  game('football_game','NFL',4,480),game('basketball_game','NBA',4,380),
  game('hockey_match','NHL',3,600),
  {...game('soccer_match','Soccer',2,NaN),soccerMinute:83}
 ]){
  assert.equal(scanTier(item),10,item.sport);
  assert.equal(scanTier({...item,home:999,away:999}),10,'Kalshi goals must not change scanner tier');
  assert.equal(scanTier({...item,home:NaN,away:NaN}),10,'missing Kalshi goals must not block promotion');
 }
});
test('ordinary live games enter 30s tier and known player crossings go straight to 10s',()=>{
 const football=game('football_game','NFL',1,680);
 assert.equal(scanTier(game('hockey_match','NHL',1,920)),30);
 assert.equal(scanTier(game('football_game','NFL',1,1200)),30);
 assert.equal(scanTier(football,{playerCrossed:true}),10);
 assert.equal(scanTier(football,{held:true}),10);
 assert.equal(scanTier({...football,verifiedLive:false}),120);
 assert.equal(scanTier(game('basketball_game','Euroleague',1,550)),null,'international basketball excluded');
 assert.equal(scanTier(game('esports_game','Esports',1,550)),null);
});
test('promotions never demote an active game until its queue record expires',()=>{
 assert.equal(priorityAfterPromotion(120,30),30);
 assert.equal(priorityAfterPromotion(30,10),10);
 assert.equal(priorityAfterPromotion(10,30),10);
 assert.equal(priorityAfterPromotion(10,120),10);
});
test('independent timer loops keep their cadence instead of waiting for discovery',async()=>{
 let fastNow=0,nearNow=0;
 const fast=[],near=[];
 await Promise.all([
  runScanTierWindow('fast',async()=>fast.push(fastNow),{now:()=>fastNow,sleep:async ms=>{fastNow+=ms},until:31000}),
  runScanTierWindow('near',async()=>near.push(nearNow),{now:()=>nearNow,sleep:async ms=>{nearNow+=ms},until:61000})
 ]);
 assert.deepEqual(fast,[0,10000,20000,30000]);
 assert.deepEqual(near,[0,30000,60000]);
});
test('independent cron routes do not run broad discovery or alter the dashboard',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(source,/url\.pathname==='\/tick\/fast'/);
 assert.match(source,/url\.pathname==='\/tick\/near'/);
 assert.match(source,/url\.pathname==='\/tick'/);
 assert.match(source,/scanFastPriorityGames/);
 assert.match(source,/scanNearPriorityGames/);
 assert.match(source,/sports_scan_tiers/);
});

test('finished games leave active scanning rather than retaining obsolete fast promotions',()=>{
 const retired={...game('football_game','NFL',4,30),verifiedLive:false,status:'final'};
 assert.equal(scanTier(retired),null);
});

test('near-entry worker evaluates initial NO preflights for all four sports and reserves fast worker for due finals',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const a=source.indexOf('async function scanNearPriorityGames(){');
 const b=source.indexOf('async function scanFastPriorityGames(',a);
 const near=source.slice(a,b);
 for(const call of [
  "scanCollegeTotalNos(ready,events,'football',null,'initial')",
  "scanCollegeTotalNos(ready,events,'basketball',null,'initial')",
  "scanHockeyTotalNos(ready,events,null,'initial')",
  "scanEarlyPeriodNos(ready,events,null,'NHL','initial')",
  "scanSoccerTotalNos(ready,events,null,'initial')",
  "scanEarlyPeriodNos(ready,events,null,'Soccer','initial')",
  "scanEarlyPeriodNos(ready,events,null,'Basketball','initial')"
 ])assert.ok(near.includes(call),call);
 assert.doesNotMatch(near,/stageCashAcrossShards|reconcileCombos|fillComboQueue|dashboard/);
 assert.match(near,/g\.state\.verifiedLive&&eligibleForMarkets\(g\.state\)&&scanTier\(g\.state\)===10/,
   'thirty-second worker must reserve expensive first-check catalogs for games promoted into the urgent tier');
});
test('fast worker atomically throttles a fixture to at most one claim per 10 seconds and skips overdue callbacks',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const worker=src.slice(src.indexOf('async function scanFastPriorityGames('),src.indexOf('const scanMinuteEnd='));
 assert.match(worker,/fast_checked_at IS NULL OR fast_checked_at<clock_timestamp\(\)-interval '10 seconds'/);
 assert.match(worker,/FOR UPDATE SKIP LOCKED/);
 assert.match(worker,/Date\.now\(\)>=until/);
});

test('bounded near-entry checks reserve capacity for each of the four sport families',async()=>{
 const {prioritizeNearCheckGames}=await import('../src/scan_tiers.mjs');
 const fixtures=[];
 for(const family of ['football','basketball','hockey','soccer'])
  for(let i=0;i<6;i++)fixtures.push({milestone:{id:family+'-'+i},state:{type:family+'_game',verifiedLive:true}});
 const selected=prioritizeNearCheckGames(fixtures,8,0);
 assert.equal(selected.length,8);
 assert.deepEqual([...new Set(selected.map(g=>g.state.type))].sort(),['basketball_game','football_game','hockey_game','soccer_game']);
 assert.ok(prioritizeNearCheckGames(fixtures,8,1).some(g=>g.milestone.id.endsWith('-2')));
});

test('two-minute discovery trigger executes only one comprehensive scan per invocation',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const route=source.slice(source.indexOf("if(req.method==='POST'&&(url.pathname==='/tick'||url.pathname==='/tick/discovery'))"),
   source.indexOf("if(req.method==='GET'&&url.pathname==='/login')"));
 assert.match(route,/while\(Date\.now\(\)<until&&cycles<1\)/,
  'discovery must not run another full scan 3 seconds after a fast completion');
});
