import {randomUUID} from 'node:crypto';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

// Soccer NO requires ESPN alone. A second fresh ESPN request remains mandatory
// 30+ elapsed seconds later; another provider must never silently authorize it.
export const SOCCER_ESPN_POLICY='soccer-espn-two-distinct-requests-v2';
export const SOCCER_ESPN_MAX_CLOCK_SKEW_SECONDS=90;
export const SOCCER_ESPN_MAX_HTTP_AGE_SECONDS=10;
const clockMinute=value=>{
 const s=String(value||'').trim().replace(/[′’]/g,"'");
 const m=s.match(/^(\d{1,3})(?::([0-5]\d))?'?(?:\+(\d{1,2}))?'?$/);
 return m?Number(m[1])+Number(m[2]||0)/60+Number(m[3]||0):NaN;
};
const currentClock=(reading,game)=>Number.isFinite(reading?.elapsedMinute)&&
 Number.isFinite(game?.soccerMinute)&&
 Math.abs(reading.elapsedMinute-game.soccerMinute)*60<=SOCCER_ESPN_MAX_CLOCK_SKEW_SECONDS;
export function validFreshEspnSoccerNo(reading,game,now=Date.now(),{allowHistorical=false}={}){
 const checked=Number(reading?.checkedAt);
 return Boolean(reading?.source==='ESPN'&&reading.verificationPolicy===SOCCER_ESPN_POLICY&&
  reading.gameId===game?.id&&String(reading.eventId||'').trim()&&
  typeof reading.requestId==='string'&&reading.requestId.length>=16&&
  reading.live===true&&reading.period===game?.period&&
  Number.isInteger(reading.home)&&reading.home>=0&&
  Number.isInteger(reading.away)&&reading.away>=0&&
  Number.isFinite(checked)&&checked>0&&now>=checked&&
  now-checked<=(allowHistorical?30*60000:10000)&&
  Number.isFinite(reading.elapsedMinute)&&
  (allowHistorical||currentClock(reading,game)&&
   reading.home===game.home&&reading.away===game.away));
}

// The second score must come from a separate HTTP request. The first is
// retained only as a historical score and event ID for contradiction checks.
export function pairedFreshEspnSoccerNo(first,second,game,now=Date.now()){
 return Boolean(validFreshEspnSoccerNo(first,game,now,{allowHistorical:true})&&
  validFreshEspnSoccerNo(second,game,now)&&
  String(first.eventId)===String(second.eventId)&&
  first.requestId!==second.requestId&&first.checkedAt<=second.checkedAt&&
  second.home>=first.home&&second.away>=first.away);
}

const daysFor=start=>[start,start-86400000,start+86400000]
 .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));

// A successful HTTP response is NOT proof the underlying scoreboard is current.
// Require an in-progress ESPN match, matching home/away score, current regulation
// period, a clock within 90s of the Kalshi scoreboard and a non-stale CDN response.
// ESPN's endpoint does not expose a guaranteed per-score update timestamp:
// reject on any unavailable or contradictory evidence, do not invent freshness.
export async function verifyFreshEspnSoccerNo(game,milestone,{fetcher=fetch}={}){
 if(game)delete game.verificationIssue;
 const start=Date.parse(milestone?.start_date||'');
 if(game?.sport!=='Soccer'||!/^soccer_/.test(String(game.type||''))||
  !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
  !game.periodConsistent||!Number.isFinite(game.soccerMinute)||
  ![1,2].includes(game.period)||!Number.isFinite(start)||
  !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
  game.observedAt>Date.now()||!Number.isInteger(game.home)||!Number.isInteger(game.away))return null;
 const requestId=randomUUID();
 // Cache-busting nonce plus no-store avoids replaying the first ESPN payload.
 const urls=espnScoreboardUrls('soccer/all',game,milestone,daysFor(start))
  .map(url=>url+'&soccer_no_request='+encodeURIComponent(requestId));
 const replies=await Promise.allSettled(urls.map(async url=>{
  const response=await fetcher(url,{cache:'no-store',
   headers:{accept:'application/json','cache-control':'no-cache'},
   signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('ESPN scoreboard unavailable');
  const ageText=response.headers?.get?.('age');
  const age=ageText==null?0:Number(ageText);
  return {board:await response.json(),age};
 }));
 const found=[];
 for(const r of replies){
  if(r.status!=='fulfilled')continue;
  const {board,age}=r.value,matched=espnMatches(board,game,milestone,{identityOnly:true});
  if(!matched.length)continue;
  if(!Number.isFinite(age)||age<0||age>SOCCER_ESPN_MAX_HTTP_AGE_SECONDS){
   game.verificationIssue='ESPN response exceeded the 10-second CDN freshness threshold';
   return false;
  }
  for(const m of matched){
   const evt=(board.events||[]).find(e=>String(e.id)===String(m.eventId));
   const status=evt?.competitions?.[0]?.status||evt?.status;
   const minute=clockMinute(status?.displayClock);
   found.push({...m,elapsedMinute:minute,live:status?.type?.state==='in'&&
    status?.type?.completed!==true});
  }
 }
 if(!found.length){
  game.verificationIssue=replies.every(r=>r.status==='rejected')?
   'ESPN soccer scoreboards could not be retrieved':
   'No exact matching fixture on the ESPN soccer scoreboard for this league and date';
  return null;
 }
 if(found.some(m=>!m.eventId||m.live!==true)){
  game.verificationIssue='ESPN identified the fixture but does not report it as live';
  return false;
 }
 if(found.some(m=>m.period!==game.period)){
  game.verificationIssue='ESPN match period does not match the exchange regulation period';
  return false;
 }
 if(found.some(m=>!Number.isInteger(m.home)||!Number.isInteger(m.away)||
  m.home!==game.home||m.away!==game.away)){
  game.verificationIssue='ESPN match score independently contradicts the exchange soccer score';
  return false;
 }
 if(found.some(m=>!currentClock(m,game))){
  game.verificationIssue='ESPN match clock missing or more than 90 seconds different';
  return false;
 }
 const eventIds=new Set(found.map(m=>String(m.eventId)));
 if(eventIds.size!==1){
  game.verificationIssue='More than one independent ESPN fixture matched the soccer event';
  return false;
 }
 const at=Date.now(),first=found[0];
 const reading={source:'ESPN',verificationPolicy:SOCCER_ESPN_POLICY,
  requestId,checkedAt:at,eventId:String(first.eventId),gameId:game.id,
  home:first.home,away:first.away,period:first.period,
  elapsedMinute:first.elapsedMinute,live:true,periods:first.periods||[],
  seconds:NaN,period3:first.periods?.[2]?
   {home:first.periods[2].home,away:first.periods[2].away}:null};
 return validFreshEspnSoccerNo(reading,game,at)?reading:false;
}