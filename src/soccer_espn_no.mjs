import {randomUUID} from 'node:crypto';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls,espnSoccerLeagueFeed} from './espn_scoreboards.mjs';
import {scoreFeedAgeMs} from './score_feed_freshness.mjs';
import {fetchIndependentMatchScore} from './independent_match_score.mjs';

// Soccer NO still needs two distinct fresh ESPN HTTP requests 30+ seconds
// apart. ESPN establishes independently matched teams, live score, period,
// and clock. Kalshi controls only the exact contract, executable quote, fees
// and position, never a veto on independently published sporting facts.
export const SOCCER_ESPN_POLICY='soccer-espn-two-distinct-requests-v2';
export const SOCCER_ESPN_MAX_CLOCK_SKEW_SECONDS=90; // legacy setting, no longer a Kalshi-equality gate
export const SOCCER_ESPN_MAX_HTTP_AGE_SECONDS=15;
const clockMinute=value=>{
 const s=String(value||'').trim().replace(/[′’]/g,"'");
 const m=s.match(/^(\d{1,3})(?::([0-5]\d))?'?(?:\+(\d{1,2}))?'?$/);
 return m?Number(m[1])+Number(m[2]||0)/60+Number(m[3]||0):NaN;
};
export function validFreshEspnSoccerNo(reading,game,now=Date.now(),{allowHistorical=false}={}){
 const checked=Number(reading?.checkedAt);
 return Boolean(['ESPN','BBC Sport'].includes(reading?.source)&&reading.verificationPolicy===SOCCER_ESPN_POLICY&&
  reading.gameId===game?.id&&String(reading.eventId||'').trim()&&
  typeof reading.requestId==='string'&&reading.requestId.length>=16&&
  reading.live===true&&reading.period===game?.period&&
  Number.isInteger(reading.home)&&reading.home>=0&&
  Number.isInteger(reading.away)&&reading.away>=0&&
  Number.isFinite(checked)&&checked>0&&now>=checked&&
  now-checked<=(allowHistorical?30*60000:15000)&&
  Number.isFinite(reading.elapsedMinute)&&reading.elapsedMinute>=0&&reading.elapsedMinute<=180);
}
export function pairedFreshEspnSoccerNo(first,second,game,now=Date.now()){
 return Boolean(validFreshEspnSoccerNo(first,game,now,{allowHistorical:true})&&
  validFreshEspnSoccerNo(second,game,now)&&
  (first.source!==second.source||String(first.eventId)===String(second.eventId))&&
  first.requestId!==second.requestId&&first.checkedAt<=second.checkedAt&&
  second.home>=first.home&&second.away>=first.away&&
  (!Number.isFinite(first.elapsedMinute)||!Number.isFinite(second.elapsedMinute)||
    second.elapsedMinute>=first.elapsedMinute));
}
// Only use a verified ESPN read to make an ephemeral risk-decision game.
// Never write ESPN scores to Kalshi, change the market, or fabricate a clock.
export function independentlyVerifiedSoccerGame(game,reading){
 if(!validFreshEspnSoccerNo(reading,game))return null;
 const minute=Number.isFinite(reading.elapsedMinute)?reading.elapsedMinute:game.soccerMinute;
 const limit=reading.period===1?45:90;
 return {...game,home:reading.home,away:reading.away,
  homeUnits:reading.home,awayUnits:reading.away,
  soccerMinute:minute,matchRemainingSeconds:Math.max(0,Math.round((limit-minute)*60)),
  scoreKnown:true,scoreConsistent:true,periodConsistent:true};
}
const daysFor=start=>{
 const hour=new Date(start).getUTCHours();
 return [start,...(hour<6?[start-86400000]:[]),...(hour>=21?[start+86400000]:[])]
  .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
};

// ESPN may disagree with Kalshi. Reject stale ESPN CDN payloads, missing
// clocks, nonlive or ambiguous ESPN matches, and inconsistent provider results.
// A covered league board is preferred; the general board is a fallback only
// when that league board truly lacks an exact two-team fixture.
export async function verifyFreshEspnSoccerNo(game,milestone,{fetcher=fetch}={}){
 if(game)delete game.verificationIssue;
 const start=Date.parse(milestone?.start_date||'');
 if(game?.sport!=='Soccer'||!/^soccer_/.test(String(game.type||''))||
  !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
  !game.periodConsistent||![1,2].includes(game.period)||!Number.isFinite(start)||
  !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
  game.observedAt>Date.now()||!Number.isInteger(game.home)||!Number.isInteger(game.away))return null;
 const requestId=randomUUID();
 const dates=daysFor(start),allowFallback=Boolean(espnSoccerLeagueFeed(milestone));
 let retrieved=false,allRejected=true,found=[];
 for(const forceAll of allowFallback?[false,true]:[false]){
  const urls=espnScoreboardUrls('soccer/all',game,milestone,dates,{forceAll})
   .map(url=>url+'&soccer_no_request='+encodeURIComponent(requestId));
  const replies=await Promise.allSettled(urls.map(async url=>{
   const response=await fetcher(url,{cache:'no-store',
    headers:{accept:'application/json','cache-control':'no-cache'},
    signal:AbortSignal.timeout(6000)});
   if(!response.ok)throw Error('ESPN scoreboard unavailable');
   const ageMs=scoreFeedAgeMs(response);
   const age=ageMs===null?Infinity:ageMs/1000;
   return {board:await response.json(),age};
  }));
  for(const r of replies){
   if(r.status!=='fulfilled')continue;
   retrieved=true;allRejected=false;
   const {board,age}=r.value,matched=espnMatches(board,game,milestone,{identityOnly:true});
   if(!matched.length)continue;
   if(!Number.isFinite(age)||age<0||age>SOCCER_ESPN_MAX_HTTP_AGE_SECONDS){
    game.verificationIssue='ESPN response exceeded the 15-second CDN freshness threshold';
    return false;
   }
   for(const m of matched){
    const evt=(board.events||[]).find(e=>String(e.id)===String(m.eventId));
    const status=evt?.competitions?.[0]?.status||evt?.status;
    found.push({...m,elapsedMinute:clockMinute(status?.displayClock),
     live:status?.type?.state==='in'&&status?.type?.completed!==true});
   }
  }
  if(found.length)break;
 }
 if(!found.length){
  game.verificationIssue=allRejected&&!retrieved?
   'ESPN soccer scoreboards could not be retrieved':
   'No exact matching fixture on the ESPN soccer scoreboard for this league and date';
  const fallback=await fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:null});
  if(fallback===false){game.verificationIssue='BBC Sport fixture is ambiguous or not live';return false}
  if(!fallback){game.verificationIssue='ESPN fixture absent; BBC Sport unavailable or no exact live fixture';return null}
  if(fallback.live!==true||fallback.period!=null&&fallback.period!==game.period||
    !Number.isInteger(fallback.home)||!Number.isInteger(fallback.away)){
    game.verificationIssue='BBC Sport fixture period or score cannot be verified';return false;
  }
  const at=Date.now(),age=fallback.sourceAgeMs||0;
  const proof={...fallback,period:fallback.period??game.period,
    elapsedMinute:Number.isFinite(fallback.elapsedMinute)?fallback.elapsedMinute:game.soccerMinute,
    clockSource:Number.isFinite(fallback.elapsedMinute)?fallback.source:'Kalshi',
    verificationPolicy:SOCCER_ESPN_POLICY,requestId,
    checkedAt:at-age};
  return validFreshEspnSoccerNo(proof,game,at)?proof:false;
 }
 if(found.some(m=>!m.eventId||m.live!==true)){
  game.verificationIssue='ESPN identified the fixture but does not report it as live';
  return false;
 }
 if(found.some(m=>m.period!==game.period)){
  game.verificationIssue='ESPN match period does not match the selected regulation segment';
  return false;
 }
 if(found.some(m=>!Number.isInteger(m.home)||!Number.isInteger(m.away)||
  m.home<0||m.away<0)){
  game.verificationIssue='ESPN fixture has no valid independently published score';
  return false;
 }
 const externalClocks=found.map(m=>m.elapsedMinute).filter(Number.isFinite);
 const selectedClock=externalClocks.length?externalClocks[0]:game.soccerMinute;
 if(externalClocks.some(minute=>minute!==selectedClock)){
  game.verificationIssue='Conflicting external match clocks';return false;
 }
 for(const match of found)if(!Number.isFinite(match.elapsedMinute))match.elapsedMinute=selectedClock;
 if(found.some(m=>!Number.isFinite(m.elapsedMinute)||m.elapsedMinute<0||m.elapsedMinute>180)){
  game.verificationIssue='ESPN match clock missing or invalid';
  return false;
 }
 const eventIds=new Set(found.map(m=>String(m.eventId)));
 if(eventIds.size!==1||found.some(m=>m.home!==found[0].home||
  m.away!==found[0].away||m.elapsedMinute!==found[0].elapsedMinute)){
  game.verificationIssue='Ambiguous or conflicting ESPN fixture/score/clock';
  return false;
 }
 const at=Date.now(),first=found[0];
 const reading={source:'ESPN',verificationPolicy:SOCCER_ESPN_POLICY,
  requestId,checkedAt:at,eventId:String(first.eventId),gameId:game.id,
  home:first.home,away:first.away,period:first.period,
  elapsedMinute:first.elapsedMinute,clockSource:externalClocks.length?'ESPN':'Kalshi',
  live:true,periods:first.periods||[],
  seconds:NaN,period3:first.periods?.[2]?
   {home:first.periods[2].home,away:first.periods[2].away}:null};
 return validFreshEspnSoccerNo(reading,game,at)?reading:false;
}
