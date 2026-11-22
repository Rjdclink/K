import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {eligibleForMarkets} from '../src/discovery.mjs';
import {loadFlashscore} from '../src/flashscore.mjs';
import {authoritativeGameState,verifiedSourceReady} from '../src/external_authority.mjs';
import {variablePlayerOverSpec,independentVariableOverDecision,variableProofValid} from '../src/variable_player_over.mjs';
import {espnMatches} from '../src/score_verification.mjs';

const now=Date.now(),start=new Date(now-20*60*1000).toISOString();
const m={id:'nfl-game',title:'MIA Dolphins at BUF Bills',type:'football_game',start_date:start,details:{league:'NFL'}};
const g=()=>gameState(m,{milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status:'live',period:1,period_remaining_time:'08:00',home_points:NaN,away_points:NaN}});
const contract={ticker:'KXNFLRECYDS-26NOV22MIABUF-BUFKSHAKIR10-10',event_ticker:'KXNFLRECYDS-26NOV22MIABUF',status:'active',strike_type:'greater',floor_strike:9.5,
 custom_strike:{football_player:'a-dedicated-id'},title:'Khalil Shakir: 10+ receiving yards',yes_sub_title:'Khalil Shakir: 10+',
 rules_primary:'If Khalil Shakir records 10+ receiving yards in the Miami vs Buffalo Pro Football game originally scheduled for Nov 22, 2026, then the market resolves to Yes.'};
const board={events:[{id:'401873070',date:start,competitions:[{status:{period:1,displayClock:'08:00',type:{state:'in'}},competitors:[
 {homeAway:'home',score:'6',team:{displayName:'Buffalo Bills',abbreviation:'BUF'}},
 {homeAway:'away',score:'0',team:{displayName:'Miami Dolphins',abbreviation:'MIA'}}]}]}]};
const play=n=>({id:'play'+n,sequenceNumber:String(n),type:{text:'Pass Reception'},isPenalty:false});
const summary={header:{id:'401873070'},boxscore:{players:[{statistics:[{name:'receiving',labels:['REC','YDS','AVG','TD','LONG','TGTS'],athletes:[{athlete:{displayName:'Khalil Shakir'},stats:['1','32','32','0','32','3']}]}]}]},drives:{previous:[{plays:[play(100)]}]}};

test('ESPN NFL player proof derives receiver and yards from exact contract and independent ESPN box score, not Kalshi stats',()=>{
 const game=g();assert.equal(game.playerStats,null);
 assert.equal(eligibleForMarkets(game),true,'unscored live games must reach independent verification');
 const spec=variablePlayerOverSpec(game,contract);
 assert.equal(spec?.player.name,'Khalil Shakir');
 assert.equal(spec?.player.metric,'RECYDS');
 const found=espnMatches(board,game,m,{identityOnly:true});
 assert.equal(found.length,1);
 const proof=independentVariableOverDecision(board,summary,game,m,contract);
 assert.equal(proof?.source,'ESPN');
 assert.equal(proof?.playerValue,32);
 const verifiedNow=Date.now();
 const later={...proof,requestedAt:verifiedNow,plays:[play(100),play(110)]};
 const first={...proof,requestedAt:verifiedNow-210000};
 assert.equal(variableProofValid(first,later,game,contract,verifiedNow),true);
});
test('absent ESPN player or wrong exact contract cannot become a qualified independent player',()=>{
 const game=g(),missing=structuredClone(summary);
 missing.boxscore.players[0].statistics[0].athletes[0].athlete.displayName='Another Player';
 assert.equal(independentVariableOverDecision(board,missing,game,m,contract),null);
 assert.equal(variablePlayerOverSpec(game,{...contract,rules_primary:contract.rules_primary.replace('10+','15+')}),null);
});
test('verification proofs stay eligible for 15 seconds and never 16',()=>{
 const game={id:'id',type:'hockey_tournament',sport:'KHL',verifiedLive:true,period:2};
 const proof={source:'Flashscore',eventId:'Ab1234Cd',gameId:game.id,home:1,away:2,period:2,live:true};
 const enriched=authoritativeGameState(game,proof,now);
 assert.equal(verifiedSourceReady(enriched,now+15000),true);
 assert.equal(verifiedSourceReady(enriched,now+16000),false);
});
test('Flashscore enforces 15-second CDN Age bound without increasing it to 30',async()=>{
 const milestone={title:'Spartak Moscow vs HC Sochi',start_date:new Date(now).toISOString(),type:'hockey_tournament',details:{league:'KHL'}};
 const game={type:'hockey_tournament',sport:'KHL'};
 const feed='SA÷4¬~ZA÷RUSSIA: KHL¬ZL÷/hockey/russia/khl/¬~AA÷Ab1234Cd¬AD÷'+Math.floor(now/1000)+'¬AB÷2¬AE÷Spartak Moscow¬AF÷HC Sochi¬AG÷1¬AH÷2¬';
 const read=age=>loadFlashscore(game,milestone,{now,fetcher:async()=>({ok:true,headers:new Headers({age:String(age)}),text:async()=>feed})});
 assert.equal((await read(14))?.length,1);
 assert.equal(await read(16),null);
});
test('candidate source reader preserves Flashscore plain text and JSON ESPN scoreboards without changing UI',async()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const a=source.indexOf('const sourceScoreReads=new Map();'),b=source.indexOf('async function externallyScoredGame(',a);
 assert.ok(a>=0&&b>a);
 let requests=0;
 const ctx=vm.createContext({Map,Date,Error,fetch:async(url)=>{
   requests++;
   return {ok:true,status:200,headers:new Headers({age:'0'}),json:async()=>({events:[{id:'score'}]}),text:async()=>('SA÷4¬~ZA÷RUSSIA: KHL¬')};
 }});
 vm.runInContext(source.slice(a,b),ctx);
 const flash=await ctx.sharedCandidateScoreboardFetch('https://global.flashscore.ninja/2/x/feed/f_4_0_-5_en_1');
 assert.equal((await flash.text()).slice(0,4),'SA÷4');
 assert.equal(flash.headers.get('age'),'0');
 const espn=await ctx.sharedCandidateScoreboardFetch('https://site.api.espn.com/scores');
 assert.equal((await espn.json()).events[0].id,'score');
 assert.equal(requests,2);
});

test('source Age and HTTP Date together cannot hide a stale provider snapshot',async()=>{
 const {scoreFeedAgeMs}=await import('../src/score_feed_freshness.mjs');
 const observed=Date.now();
 const reading=(age,secondsAgo)=>({headers:new Headers({age:String(age),date:new Date(observed-secondsAgo*1000).toUTCString()})});
 assert.ok(scoreFeedAgeMs(reading(14,3),observed)<=15000);
 assert.equal(scoreFeedAgeMs(reading(16,0),observed),null);
 assert.equal(scoreFeedAgeMs(reading(1,20),observed),null);
 assert.equal(scoreFeedAgeMs({headers:new Headers({age:'invalid'})},observed),null);
});
test('final purchase authorization expires at 15 seconds even after two valid independent proofs',async()=>{
 const {rememberIndependentEntry,independentEntryValid}=await import('../src/entry_verification.mjs');
 const proofGame={id:'nfl-check',verificationId:'verified-id'},seller={ticker:'KXNFLRECYDS-T',event_ticker:'KXNFLRECYDS',floor_strike:9.5};
 const current=Date.now();
 rememberIndependentEntry(proofGame,seller,'verified-id',current,32);
 assert.equal(independentEntryValid(proofGame,seller,current+15000),true);
 assert.equal(independentEntryValid(proofGame,seller,current+16000),false);
});

test('a 14-second-old source cannot be re-dated at local fetch time to authorize a 16-second-old trade',async()=>{
 const {rememberIndependentEntry,independentEntryValid}=await import('../src/entry_verification.mjs');
 const now=Date.now(),game={id:'nfl-independent',type:'football_game',sport:'NFL',verifiedLive:true,period:2,verificationId:'auth-1'};
 const proof={source:'ESPN',eventId:'nfl-espn-1',gameId:game.id,period:2,home:6,away:3,live:true,sourceAgeMs:14000};
 const enriched=authoritativeGameState(game,proof,now);
 assert.ok(enriched);
 assert.equal(verifiedSourceReady(enriched,now+1000),true);
 assert.equal(verifiedSourceReady(enriched,now+2000),false);
 const contract={ticker:'KXNFLTOTAL-TEST',event_ticker:'KXNFLTOTAL',floor_strike:8.5};
 rememberIndependentEntry(enriched,contract,'auth-1',now,9);
 assert.equal(independentEntryValid(enriched,contract,now+1000),true);
 assert.equal(independentEntryValid(enriched,contract,now+2000),false);
});
