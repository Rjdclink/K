import {randomUUID} from 'node:crypto';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {scoreFeedAgeMs} from './score_feed_freshness.mjs';
import {fetchIndependentMatchScore} from './independent_match_score.mjs';

// Same two-distinct-ESPN-request policy as soccer NO; NHL scoreboards report
// a remaining period clock instead of an elapsed soccer regulation minute.
export const HOCKEY_ESPN_POLICY='hockey-espn-two-distinct-requests-v1';
export const HOCKEY_ESPN_MAX_CLOCK_SKEW_SECONDS=90; // legacy setting, no Kalshi equality veto
export const HOCKEY_ESPN_MAX_HTTP_AGE_SECONDS=15;

const clockSeconds=value=>{
 const match=String(value||'').trim().match(/^(\d{1,2}):([0-5]\d)(?:\.\d{1,3})?$/);
 return match?Number(match[1])*60+Number(match[2]):NaN;
};
export function validFreshEspnHockeyNo(reading,game,now=Date.now(),{allowHistorical=false}={}){
 const checked=Number(reading?.checkedAt);
 return Boolean(['ESPN','NHL'].includes(reading?.source)&&reading.verificationPolicy===HOCKEY_ESPN_POLICY&&
  game?.sport==='NHL'&&reading.gameId===game?.id&&String(reading.eventId||'').trim()&&
  typeof reading.requestId==='string'&&reading.requestId.length>=16&&
  reading.live===true&&reading.period===game?.period&&
  Number.isInteger(reading.home)&&reading.home>=0&&
  Number.isInteger(reading.away)&&reading.away>=0&&
  Number.isFinite(checked)&&checked>0&&now>=checked&&
  now-checked<=(allowHistorical?30*60000:15000)&&
  Number.isFinite(reading.seconds)&&reading.seconds>=0&&reading.seconds<=1200);
}

export function pairedFreshEspnHockeyNo(first,second,game,now=Date.now()){
 return Boolean(validFreshEspnHockeyNo(first,game,now,{allowHistorical:true})&&
  validFreshEspnHockeyNo(second,game,now)&&
  (first.source!==second.source||String(first.eventId)===String(second.eventId))&&
  first.requestId!==second.requestId&&first.checkedAt<=second.checkedAt&&
  second.home>=first.home&&second.away>=first.away&&
  (!Number.isFinite(first.seconds)||!Number.isFinite(second.seconds)||
    second.seconds<=first.seconds));
}

// Use independently confirmed ESPN scoring and period time for NO risk
// decisions. Never write these fields back to Kalshi's contract or portfolio.
export function independentlyVerifiedHockeyGame(game,reading){
 if(!validFreshEspnHockeyNo(reading,game))return null;
 return {...game,home:reading.home,away:reading.away,
  homeUnits:reading.home,awayUnits:reading.away,
  remainingSeconds:Number.isFinite(reading.seconds)?reading.seconds:game.remainingSeconds,
  scoreKnown:true,scoreConsistent:true,
  periodConsistent:true};
}

const daysFor=start=>[start,start-86400000,start+86400000]
 .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));

// Only ESPN determines the score and remaining clock for risk decisions.
// Two fresh independent HTTP requests still establish the exact NHL fixture.
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
  const ageMs=scoreFeedAgeMs(reply);
  const age=ageMs===null?Infinity:ageMs/1000;
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
 if(!found.length){
  const fallback=await fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:null});
  if(fallback===false)return false;
  if(!fallback)return null;
  if(!Number.isInteger(fallback.period)||fallback.period!==game.period||
    !Number.isInteger(fallback.home)||!Number.isInteger(fallback.away))return false;
  const at=Date.now();
  const proof={...fallback,verificationPolicy:HOCKEY_ESPN_POLICY,requestId,
    checkedAt:at-(fallback.sourceAgeMs||0),
    period3:fallback.periods?.[2]||null,
    currentPeriod:fallback.periods?.[game.period-1]||null};
  return validFreshEspnHockeyNo(proof,game,at)?proof:false;
 }
 if(found.some(match=>!match.eventId||match.live!==true||match.period!==game.period||
  !Number.isInteger(match.home)||!Number.isInteger(match.away)||
  match.home<0||match.away<0||!Number.isFinite(match.seconds)||
  match.seconds<0||match.seconds>1200))return false;
 if(new Set(found.map(m=>String(m.eventId))).size!==1||
   found.some(m=>m.home!==found[0].home||m.away!==found[0].away||
     m.seconds!==found[0].seconds))return false;
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
