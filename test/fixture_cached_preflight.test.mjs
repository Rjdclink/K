import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
import {createFixtureEventCache} from '../src/fixture_event_cache.mjs';
const milestone={id:'kalshi-123',type:'soccer_tournament_multi_leg',title:'Northbridge Wndrs vs Southport Utd',
 start_date:'2026-11-20T18:00:00Z',details:{league:'Eliteserien'}};
const game=(home=2,away=1)=>({id:milestone.id,type:milestone.type,sport:'Soccer',verifiedLive:true,
 home,away,homeName:'Northbridge Wndrs',awayName:'Southport Utd'});
const espn=(home=2,away=1,teamHome='Northbridge Wanderers',teamAway='Southport United',id='ESPN-99')=>({
 events:[{id,date:milestone.start_date,uid:'s:600~l:3960~e:'+id,competitions:[{
 status:{type:{state:'in'},period:2,displayClock:"87'"},competitors:[
 {homeAway:'home',team:{displayName:teamHome,name:teamHome},score:String(home)},
 {homeAway:'away',team:{displayName:teamAway,name:teamAway},score:String(away)}
 ]}]}]});
const fetcher=board=>async url=>({ok:true,json:async()=>({events:url.includes('dates=20261120')?board.events:[]})});
const store=()=>{
 const refs=new Map(),reads=[];return {
  refs,reads,
  get:async(g,m,source)=>{reads.push([g.id,m.start_date,source]);return refs.get(g.id+':'+source)||null;},
  put:async(g,m,source,id)=>{const key=g.id+':'+source;const old=refs.get(key);
   if(old&&old!==id)return false;refs.set(key,id);return true;}
 };
};
test('first exact verified event ID is reused when a provider subsequently changes both displayed team aliases',async()=>{
 const cache=store();
 const first=await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(espn()),espnFeed:'soccer/all',fixtureCache:cache});
 assert.equal(first?.eventId,'ESPN-99');assert.equal(cache.refs.get('kalshi-123:ESPN'),'ESPN-99');
 const renamed=espn(3,1,'New Unrelated Name','Another Name','ESPN-99');
 const fresh=await fetchIndependentMatchScore(game(3,1),milestone,{fetcher:fetcher(renamed),espnFeed:'soccer/all',fixtureCache:cache});
 assert.deepEqual([fresh?.home,fresh?.away],[3,1]);
 assert.equal(fresh?.eventId,'ESPN-99');
 assert.equal(cache.reads.length,2);
});
test('cached ID never bypasses current scoreboard scores and never accepts a changed provider ID',async()=>{
 const cache=store();
 await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(espn()),espnFeed:'soccer/all',fixtureCache:cache});
 const wrong=await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(espn(3,1,'Different','Other')),
  espnFeed:'soccer/all',fixtureCache:cache});
 assert.equal(wrong,false,'previously matching ESPN game ID with a new different score is a veto');
 const swapped=await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(espn(2,1,'Northbridge Wanderers','Southport United','ESPN-100')),
  espnFeed:'soccer/all',fixtureCache:cache});
 assert.equal(swapped,false,'cached same-game event ID may not be silently changed');
 assert.equal(cache.refs.get('kalshi-123:ESPN'),'ESPN-99');
});
test('cache is not populated from ambiguous fixtures or unverified scores',async()=>{
 const cache=store();
 const ambiguous={events:[...espn().events,...espn(2,1,'Northbridge Wanderers','Southport United','ESPN-100').events]};
 assert.equal(await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(ambiguous),espnFeed:'soccer/all',fixtureCache:cache}),false);
 assert.equal(cache.refs.size,0);
 assert.equal(await fetchIndependentMatchScore(game(),milestone,{fetcher:fetcher(espn(3,1)),espnFeed:'soccer/all',fixtureCache:cache}),false);
 assert.equal(cache.refs.size,0);
});