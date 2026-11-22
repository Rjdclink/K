import test from 'node:test';
import assert from 'node:assert/strict';
import {flashscoreCompetition,parseFlashscoreFeed,loadFlashscore} from '../src/flashscore.mjs';
import {fetchIndependentMatchScore} from '../src/independent_match_score.mjs';
import {verifiedSourceReady,authoritativeGameState} from '../src/external_authority.mjs';
import {verifyIndependentOverDecision} from '../src/score_verification.mjs';

const start='2026-11-22T16:00:00Z';
const milestone={id:'kalshi-khl-1',title:'Spartak Moscow vs HC Sochi',start_date:start,details:{league:'KHL'}};
const game={id:'kalshi-khl-1',type:'hockey_tournament',sport:'KHL',competition:'KHL',verifiedLive:true,scoreKnown:true,home:5,away:2,homeName:'Spartak Moscow',awayName:'HC Sochi',period:3};
const row=(options={})=>{
 const {home='Spartak Moscow',away='HC Sochi',homeScore=5,awayScore=2,status=2,id='7BD57kHq',time=start}=options;
 return `AA÷${id}¬AD÷${Date.parse(time)/1000}¬AB÷${status}¬AC÷16¬AE÷${home}¬AF÷${away}¬AG÷${homeScore}¬AH÷${awayScore}¬BA÷1¬BB÷0¬BC÷3¬BD÷1¬BE÷1¬BF÷1¬`;
};
const feed=(entries=[row()])=>`SA÷4¬~ZA÷RUSSIA: KHL¬ZL÷/hockey/russia/khl/¬~${entries.join('~')}`;
const response=text=>({ok:true,status:200,headers:new Headers(),text:async()=>text});

test('only enumerated ESPN-unavailable competitions may use Flashscore',()=>{
 assert.equal(flashscoreCompetition(game,milestone)?.sportId,4);
 assert.equal(flashscoreCompetition({...game,sport:'NHL',competition:'NHL'},{...milestone,details:{league:'NHL'}}),null);
 assert.equal(flashscoreCompetition({sport:'NBA',type:'basketball_game'},{details:{league:'NBA'}}),null);
 assert.equal(flashscoreCompetition({sport:'Soccer',type:'soccer_tournament_multi_leg'},{details:{league:'EPL'}}),null);
 assert.equal(flashscoreCompetition({sport:'Soccer',type:'soccer_tournament_multi_leg'},{details:{league:'Japan J2 League'}})?.sportId,1);
 assert.equal(flashscoreCompetition({sport:'Soccer',type:'esports_match'},{details:{league:'Japan J2 League'}}),null);
});
test('Flashscore requires the exact league, match identity, live status and numeric scores',()=>{
 const parsed=parseFlashscoreFeed(feed(),flashscoreCompetition(game,milestone));
 assert.equal(parsed.length,1);
 assert.deepEqual({home:parsed[0].home,away:parsed[0].away,period:parsed[0].period,live:parsed[0].live},{home:5,away:2,period:3,live:true});
 assert.deepEqual(parsed[0].periods,[{number:1,home:1,away:0},{number:2,home:3,away:1},{number:3,home:1,away:1}]);
 assert.equal(parseFlashscoreFeed(feed([row({status:3})]),flashscoreCompetition(game,milestone))[0].live,false);
 assert.equal(parseFlashscoreFeed(feed([row({homeScore:'unknown'})]),flashscoreCompetition(game,milestone)).length,0);
 assert.equal(parseFlashscoreFeed(feed().replace('/hockey/russia/khl/','/hockey/usa/ahl/'),flashscoreCompetition(game,milestone)).length,0);
});
test('two unavailable ESPN attempts then Flashscore establish a live exact independent fixture',async()=>{
 const calls=[];
 const proof=await fetchIndependentMatchScore(game,milestone,{espnFeed:'hockey/khl',foxFeed:null,fetcher:async(url)=>{
  calls.push(url);
  if(url.includes('espn.com'))return {ok:false,status:400};
  if(url.includes('flashscore.ninja'))return response(feed());
  throw Error('Unexpected external source');
 }});
 assert.deepEqual(calls.filter(url=>url.includes('espn.com')).length,6);
 assert.equal(calls.filter(url=>url.includes('flashscore.ninja')).length,1);
 assert.equal(proof?.source,'Flashscore');
 assert.equal(proof?.eventId,'7BD57kHq');
 const enriched=authoritativeGameState(game,proof);
 assert.equal(enriched?.externalScore.source,'Flashscore');
 assert.equal(verifiedSourceReady(enriched),true);
});
test('no Flashscore authorization for ambiguous fixtures, wrong teams, finished games or ESPN contradiction',async()=>{
 const run=async(text,espnResult=null)=>{
  let flash=0;
  const result=await fetchIndependentMatchScore(game,milestone,{espnFeed:'hockey/khl',foxFeed:null,fetcher:async u=>{
   if(u.includes('espn.com'))return {ok:true,json:async()=>espnResult??{events:[]}};
   flash++;return response(text);
  }});
  return {result,flash};
 };
 assert.equal((await run(feed([row(),row({id:'another1'})]))).result,false);
 assert.equal((await run(feed([row({away:'Other team'})]))).result,null);
 assert.equal((await run(feed([row({status:3})]))).result,false);
 const contradiction={events:[{id:'conflict',date:start,competitions:[{competitors:[{homeAway:'home',score:1,team:{displayName:'Spartak Moscow'}},{homeAway:'away',score:2,team:{displayName:'HC Sochi'}}],status:{period:3,type:{state:'in'}}}]}]};
 const value=await run(feed(),contradiction);
 assert.equal(value.result?.source,'ESPN');assert.equal(value.flash,0);
});

test('previous-day UTC-crossing hockey games use their actual Flashscore local scoreboard date',async()=>{
 const prior={...milestone,start_date:'2026-11-22T00:00:00Z'};
 const urls=[];
 await loadFlashscore(game,prior,{now:Date.parse('2026-11-22T17:00:00Z'),fetcher:async url=>{
   urls.push(url);return response(feed());
 }});
 assert.equal(urls.length,1);
 assert.match(urls[0],/f_4_-1_-5_en_1$/);
});
test('non-NHL Kalshi hockey titles list away first; fallback resolves home and away without reversing points',async()=>{
 const m={...milestone,title:'Utica Comets vs Cleveland Monsters',details:{league:'AHL'}};
 const g={...game,competition:'AHL',sport:'AHL',homeName:'',awayName:'',home:1,away:2};
 const rowText=`AA÷Ahl12aBc¬AD÷${Date.parse(start)/1000}¬AB÷2¬AC÷16¬AE÷Cleveland Monsters¬AF÷Utica Comets¬AG÷1¬AH÷2¬BA÷0¬BB÷1¬BC÷0¬BD÷1¬BE÷1¬BF÷0¬`;
 const proof=await fetchIndependentMatchScore(g,m,{espnFeed:null,fetcher:async()=>response(`SA÷4¬~ZA÷USA: AHL¬ZL÷/hockey/usa/ahl/¬~${rowText}`)});
 assert.deepEqual([proof?.source,proof?.home,proof?.away],['Flashscore',1,2]);
});

test('unsupported hockey skips nonexistent ESPN routes and verifies via Flashscore without Sportradar',async()=>{
 const calls=[],market={event_ticker:'KXKHLTOTAL-TEST',floor_strike:5.5};
 const decision=await verifyIndependentOverDecision({...game},milestone,{market,fetcher:async url=>{
   calls.push(url);
   if(url.includes('espn.com'))return {ok:false,status:400};
   if(url.includes('flashscore.ninja'))return response(feed());
   throw Error('Unexpected provider');
 }});
 assert.equal(decision,true);
 assert.equal(calls.filter(u=>u.includes('espn.com')).length,0,'no ESPN hockey league feed exists to retry');
 assert.equal(calls.filter(u=>u.includes('flashscore.ninja')).length,1);
 assert.ok(calls.every(u=>!u.includes('sportradar.com')));
});

test('confirmed J2 soccer gap retries its real ESPN scoreboard once before Flashscore',async()=>{
 const kick='2026-11-22T08:00:00Z';
 const m={id:'j2',title:'Shonan vs Tokushima',start_date:kick,details:{league:'Japan J2 League'}};
 const g={id:'j2',type:'soccer_tournament_multi_leg',sport:'Soccer',competition:'Japan J2 League',homeName:'Shonan Bellmare',awayName:'Tokushima Vortis',home:1,away:0,verifiedLive:true,scoreKnown:true,period:2};
 const body=`SA÷1¬~ZA÷JAPAN: J2 League¬ZL÷/football/japan/j2-league/¬~AA÷Jp123Aab¬AD÷${Date.parse(kick)/1000}¬AB÷2¬AC÷13¬AE÷Shonan Bellmare¬AF÷Tokushima Vortis¬AG÷1¬AH÷0¬`;
 const urls=[];
 const result=await fetchIndependentMatchScore(g,m,{espnFeed:'soccer/all',foxFeed:'soccer',fetcher:async url=>{
   urls.push(url);return url.includes('espn.com')?{ok:false,status:503}:response(body);
 }});
 assert.equal(result?.source,'Flashscore');
 assert.equal(urls.filter(u=>u.includes('espn.com')).length,6);
 assert.equal(urls.filter(u=>u.includes('flashscore.ninja')).length,1);
 assert.equal(urls.some(u=>u.includes('foxsports.com')||u.includes('sportradar.com')),false);
});
