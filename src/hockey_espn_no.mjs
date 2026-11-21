import {randomUUID} from 'node:crypto';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

// Same two-distinct-ESPN-request policy as soccer NO; NHL scoreboards report
// a remaining period clock instead of an elapsed soccer regulation minute.
export const HOCKEY_ESPN_POLICY='hockey-espn-two-distinct-requests-v1';
export const HOCKEY_ESPN_MAX_CLOCK_SKEW_SECONDS=90;
export const HOCKEY_ESPN_MAX_HTTP_AGE_SECONDS=10;

const clockSeconds=value=>{
 const match=String(value||'').trim().match(/^(\d{1,2}):([0-5]\d)(?:\.\d{1,3})?$/);
 return match?Number(match[1])*60+Number(match[2]):NaN;
};
const currentClock=(reading,game)=>Number.isFinite(reading?.seconds)&&
 Number.isFinite(game?.remainingSeconds)&&
 Math.abs(reading.seconds-game.remainingSeconds)<=HOCKEY_ESPN_MAX_CLOCK_SKEW_SECONDS;

export function validFreshEspnHockeyNo(reading,game,now=Date.now(),{allowHistorical=false}={}){
 const checked=Number(reading?.checkedAt);
 return Boolean(reading?.source==='ESPN'&&reading.verificationPolicy===HOCKEY_ESPN_POLICY&&
  game?.sport==='NHL'&&reading.gameId===game?.id&&String(reading.eventId||'').trim()&&
  typeof reading.requestId==='string'&&reading.requestId.length>=16&&
  reading.live===true&&reading.period===game?.period&&
  Number.isInteger(reading.home)&&reading.home>=0&&
  Number.isInteger(reading.away)&&reading.away>=0&&
  Number.isFinite(checked)&&checked>0&&now>=checked&&
  now-checked<=(allowHistorical?30*60000:10000)&&
  Number.isFinite(reading.seconds)&&
  (allowHistorical||currentClock(reading,game)&&
   reading.home===game.home&&reading.away===game.away));
}

export function pairedFreshEspnHockeyNo(first,second,game,now=Date.now()){
 return Boolean(validFreshEspnHockeyNo(first,game,now,{allowHistorical:true})&&
  validFreshEspnHockeyNo(second,game,now)&&
  String(first.eventId)===String(second.eventId)&&
  first.requestId!==second.requestId&&first.checkedAt<=second.checkedAt&&
  second.home>=first.home&&second.away>=first.away);
}

const daysFor=start=>[start,start-86400000,start+86400000]
 .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));

// Kalshi remains the clock for order eligibility, while two independent,
// cache-busted ESPN HTTP responses must confirm the live fixture, score,
// period, and a non-stale clock close to the current Kalshi observation.
export async function verifyFreshEspnHockeyNo(game,milestone,{fetcher=fetch}={}){
 const start=Date.parse(milestone?.start_date||'');
 if(game?.sport!=='NHL'||!['hockey_match','hockey_game'].includes(game.type)||
  !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
  !game.periodConsistent||![1,2,3,4].includes(game.period)||
  !Number.isFinite(start)||!Number.isFinite(game.remainingSeconds)||
  !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
  game.observedAt>Date.now()||!Number.isInteger(game.home)||!Number.isInteger(game.away))
  return null;
 const requestId=randomUUID();
 const urls=espnScoreboardUrls('hockey/nhl',game,milestone,daysFor(start))
  .map(url=>url+'&hockey_no_request='+encodeURIComponent(requestId));
 const responses=await Promise.allSettled(urls.map(async url=>{
  const reply=await fetcher(url,{cache:'no-store',
   headers:{accept:'application/json','cache-control':'no-cache'},
   signal:AbortSignal.timeout(6000)});
  if(!reply.ok)throw Error('ESPN scoreboard unavailable');
  const header=reply.headers?.get?.('age');
  const age=header==null?0:Number(header);
  return {scoreboard:await reply.json(),age};
 }));
 const found=[];
 for(const response of responses){
  if(response.status!=='fulfilled')continue;
  const {scoreboard,age}=response.value;
  const matched=espnMatches(scoreboard,game,milestone,{identityOnly:true});
  if(!matched.length)continue;
  if(!Number.isFinite(age)||age<0||age>HOCKEY_ESPN_MAX_HTTP_AGE_SECONDS)
   return false;
  for(const match of matched){
   const event=(scoreboard.events||[]).find(e=>String(e.id)===String(match.eventId));
   const status=event?.competitions?.[0]?.status||event?.status;
   const seconds=clockSeconds(status?.displayClock);
   found.push({...match,seconds,live:status?.type?.state==='in'&&
    status?.type?.completed!==true});
  }
 }
 if(!found.length)return null;
 if(found.some(match=>!match.eventId||match.live!==true||match.period!==game.period||
  !Number.isInteger(match.home)||!Number.isInteger(match.away)||
  match.home!==game.home||match.away!==game.away||
  !currentClock(match,game)))return false;
 if(new Set(found.map(m=>String(m.eventId))).size!==1)return false;
 const at=Date.now(),match=found[0];
 const reading={source:'ESPN',verificationPolicy:HOCKEY_ESPN_POLICY,
  requestId,checkedAt:at,eventId:String(match.eventId),gameId:game.id,
  home:match.home,away:match.away,period:match.period,seconds:match.seconds,
  live:true,periods:match.periods||[],
  period3:match.periods?.[2]?
   {home:match.periods[2].home,away:match.periods[2].away}:null,
  currentPeriod:match.periods?.[game.period-1]?
   {home:match.periods[game.period-1].home,away:match.periods[game.period-1].away}:null};
 return validFreshEspnHockeyNo(reading,game,at)?reading:false;
}