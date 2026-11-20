import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {verifyIndependentVariableOver} from '../src/variable_player_over.mjs';

const start=new Date(Date.now()-20*60000).toISOString();
const milestone={id:'nba-fallback',title:'Away at Home',type:'basketball_game',start_date:start,
 details:{league:'NBA',main_game_event_ticker:'KXNBAGAME-FALLBACK'}};
const game=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
 details:{status:'live',home_score:20,away_score:10,period:1,clock:'08:00',last_updated_ts:Date.now()/1000,
 home_team_name:'Home',away_team_name:'Away',player_stats:{p:{points:22}}}});
const market={ticker:'KXNBAPTS-FALLBACK-PAT-20',event_ticker:'KXNBAPTS-FALLBACK',status:'active',
 floor_strike:19.5,strike_type:'greater',custom_strike:{basketball_player:'p'},
 title:'Pat Player: 20+ points',yes_sub_title:'Pat Player: 20+',
 rules_primary:'If Pat Player records 20+ points in the Away vs Home NBA game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'};
const board=(home=20)=>({events:[{id:'ESPN-42',date:start,
 competitions:[{status:{period:1,displayClock:'08:00',type:{state:'in'}},competitors:[
 {homeAway:'home',score:String(home),team:{displayName:'Home'}},
 {homeAway:'away',score:'10',team:{displayName:'Away'}}]}]}]});
const summary=(points=22)=>({header:{id:'ESPN-42'},
 boxscore:{players:[{statistics:[{name:'scoring',labels:['PTS'],athletes:[{
 athlete:{displayName:'Pat Player'},stats:[String(points)]}]}]}]},
 plays:[{id:'nba-play-100',sequenceNumber:'100',type:{text:'Made Shot'}}]});
const foxBoard={sectionList:[{events:[{eventStatus:1,eventTime:start,statusLine:'1ST 08:00',
 entityLink:{layout:{tokens:{homeUri:'HOM',awayUri:'AWY',id:'222222'}}},
 upperTeam:{uri:'AWY',name:'Away',longName:'Away',score:'10'},
 lowerTeam:{uri:'HOM',name:'Home',longName:'Home',score:'20'}}]}]};
const foxData={header:{id:'222222'},boxscore:{boxscoreSections:[{boxscoreItems:[{boxscoreTable:{
 headers:[{columns:[{text:'PTS',index:0}]}],
 rows:[{entityLink:{title:'Pat Player'},columns:[{index:0,text:'22'}]}]}}]}]},
 pbp:{sections:[{groups:[{plays:[{id:'100',playDescription:'Pat Player makes 2 point layup',timeOfPlay:'08:00'}]}]}]}};
function fetcher({espnUnavailable=false,espnContradicts=false,failFirstEspn=false,foxUnavailable=false}={}){
 const calls=[];let espnScoreboardReads=0;
 return {calls,fetcher:async url=>{
  calls.push(url);
  if(url.includes('espn.com')){
    if(url.includes('/scoreboard')){espnScoreboardReads++;
      if(espnUnavailable||failFirstEspn&&espnScoreboardReads<=3)return {ok:false,status:503};
      return {ok:true,json:async()=>board(espnContradicts?21:20)};}
    return {ok:true,json:async()=>summary()};
  }
  if(url.includes('foxsports.com')){
    if(foxUnavailable)return {ok:false,status:503};
    return {ok:true,json:async()=>url.includes('/event/')?foxData:foxBoard};
  }
  throw Error('unexpected '+url);
 }};
}

test('valid ESPN proof prevents retry and FOX calls',async()=>{
 const h=fetcher();const result=await verifyIndependentVariableOver(game,milestone,market,{fetcher:h.fetcher});
 assert.equal(result?.source,'ESPN');assert.equal(h.calls.filter(x=>x.includes('foxsports.com')).length,0);
});
test('contradictory matched ESPN score blocks without consulting FOX',async()=>{
 const h=fetcher({espnContradicts:true});
 const result=await verifyIndependentVariableOver(game,milestone,market,{fetcher:h.fetcher});
 assert.equal(result,null);assert.equal(h.calls.filter(x=>x.includes('foxsports.com')).length,0);
});
test('FOX may be queried only after the initial and retried ESPN checks are unavailable',async()=>{
 const h=fetcher({espnUnavailable:true});
 const result=await verifyIndependentVariableOver(game,milestone,market,{fetcher:h.fetcher});
 assert.equal(result?.source,'FOX Sports');
 const firstFox=h.calls.findIndex(x=>x.includes('foxsports.com'));
 assert.ok(firstFox>0);assert.ok(h.calls.slice(0,firstFox).every(x=>x.includes('espn.com')));
 assert.ok(h.calls.slice(0,firstFox).filter(x=>x.includes('scoreboard')).length>=2);
});
test('an unavailable FOX source fails closed after two ESPN attempts',async()=>{
 const h=fetcher({espnUnavailable:true,foxUnavailable:true});
 const result=await verifyIndependentVariableOver(game,milestone,market,{fetcher:h.fetcher});
 assert.equal(result,null);assert.equal(h.calls.some(x=>x.includes('foxsports.com')),true);
});