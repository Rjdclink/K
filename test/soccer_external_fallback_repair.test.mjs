import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchIndependentMatchScore,pairedExternalMatch} from '../src/independent_match_score.mjs';
import {tagNoPreflight,validNoPreflight,lateNoPreflightProgress} from '../src/late_no_preflight.mjs';
import {externalNoScore} from '../src/external_no_authority.mjs';
import {authoritativeGameState,verifiedSourceReady} from '../src/external_authority.mjs';
import {loadSportradar} from '../src/sportradar.mjs';
const start=new Date(Date.now()-25*60000).toISOString();
const milestone={id:'verified',title:'Alpha vs Beta',type:'soccer_match',start_date:start,details:{league:'Soccer'}};
const game={id:'verified',type:'soccer_match',sport:'Soccer',home:0,away:1,homeName:'Alpha',awayName:'Beta',period:2,
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true};
const radar={eventId:'sr:sport_event:123456',time:start,homeAliases:['Alpha'],awayAliases:['Beta'],
 home:0,away:1,live:true,period:2,periods:[{number:1,home:0,away:1},{number:2,home:0,away:0}]};
const fetcher=async()=>({ok:true,json:async()=>({events:[],sectionList:[]})});
test('ESPN and FOX unavailable means exact Sportradar soccer live reading can verify, not fabricate',async()=>{
 let checks=0;
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:'soccer',fetcher,
   sportradarLoad:async(g,m,{matchFixture})=>{
    checks++;assert.equal(matchFixture(['Alpha'],['Beta'],start),true);
    assert.equal(matchFixture(['Wrong'],['Beta'],start),false);
    return [radar];
   }});
 assert.equal(checks,1);
 assert.equal(proof.source,'Sportradar');
 assert.equal(proof.eventId,'sr:sport_event:123456');
 assert.deepEqual(externalNoScore(game,proof),{home:0,away:1});
 const tagged=tagNoPreflight(proof),now=Date.now();
 const win={game_id:game.id,period:2,contract_key:'key',first_at:new Date(now-30000),
  first_clock:400,first_evidence:tagged};
 assert.equal(validNoPreflight(win,{gameId:game.id,period:2,contractKey:'key',maxFirstSeconds:600,now}),true);
 assert.equal(lateNoPreflightProgress(win,now).ready,true);
});
test('source ambiguity, wrong teams, stale fixture, non-live or spoofed ID all block',async()=>{
 for(const [rows,expected] of [
 [[{...radar,homeAliases:['Wrong']}],null],
 [[radar,{...radar,eventId:'sr:sport_event:321321'}],false],
 [[{...radar,live:false}],false],
 [[{...radar,eventId:'fake'}],null],
 [[{...radar,time:new Date(Date.now()-8*3600000).toISOString()}],null]
 ]){
  assert.equal(await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:'soccer',fetcher,
    sportradarLoad:async()=>rows}),expected);
 }
});
test('ESPN exact match remains priority; even contradictory ESPN blocks later sources',async()=>{
 const espn={events:[{id:'verified-espn',date:start,competitions:[{status:{period:2,type:{state:'in'}},
  competitors:[{homeAway:'home',score:'0',team:{displayName:'Alpha'}},
               {homeAway:'away',score:'1',team:{displayName:'Beta'}}]}]}]};
 let fallback=0;
 const matched=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:'soccer',
  fetcher:async u=>({ok:true,json:async()=>u.includes('espn')?espn:{sectionList:[]}}),
  sportradarLoad:async()=>{fallback++;return [radar]}});
 assert.equal(matched?.source,'ESPN');assert.equal(fallback,0);
 const wrong={...espn,events:[...espn.events,{...espn.events[0],id:'other'}]};
 const contradiction=await fetchIndependentMatchScore(game,milestone,{espnFeed:'soccer/all',foxFeed:'soccer',
  fetcher:async()=>({ok:true,json:async()=>wrong}),
  sportradarLoad:async()=>{fallback++;return [radar]}});
 assert.equal(contradiction,false);assert.equal(fallback,0);
});
test('fresh verified Sportradar reading passes source authority but cannot be reused after expiry',()=>{
 const now=Date.now();
 const checked=authoritativeGameState(game,{source:'Sportradar',eventId:'sr:sport_event:123456',
  gameId:game.id,home:0,away:1,live:true,period:2},now);
 assert.equal(checked?.externalScore?.source,'Sportradar');
 assert.equal(verifiedSourceReady(checked,now+9999),true);
 assert.equal(verifiedSourceReady(checked,now+10001),false);
 assert.equal(pairedExternalMatch({source:'ESPN',eventId:'one',gameId:game.id,home:0,away:0},
  {source:'Sportradar',eventId:'sr:sport_event:123456',gameId:game.id,home:0,away:1},game),true);
});
