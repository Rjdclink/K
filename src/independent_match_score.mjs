import {espnMatches,foxMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {espnRetryThenFox} from './source_fallback.mjs';

// These are site-facing public scoreboard formats already used by K. A source
// with no exact fixture is unavailable, not verification. A matched fixture
// with a conflicting score is a veto, never permission to try another source.
const FOX_PUBLIC_KEY='jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq';
const foxQuery=`apikey=${FOX_PUBLIC_KEY}&api-version=1.1`;
export const scorePairMatches=(reading,game)=>Boolean(
  ['ESPN','FOX Sports'].includes(reading?.source)&&reading.eventId&&
  Number.isInteger(reading.home)&&Number.isInteger(reading.away)&&
  reading.home===game.home&&reading.away===game.away);

const daysFor=start=>[start,start-86400000,start+86400000]
  .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-'));
const pull=async(url,fetcher)=>{
  const response=await fetcher(url,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('Scoreboard unavailable');
  return response.json();
};
const select=(boards,game,milestone,source)=>{
  const matches=boards.flatMap(b=>source==='ESPN'?espnMatches(b,game,milestone):foxMatches(b,game,milestone));
  if(!matches.length)return null;
  const unique=new Map();
  for(const m of matches){
    if(!m.eventId)return false;
    const id=String(m.eventId),previous=unique.get(id);
    if(previous&&(previous.home!==m.home||previous.away!==m.away))return false;
    if(!previous||Number(m.periods?.length||0)>Number(previous.periods?.length||0))unique.set(id,m);
  }
  if(unique.size!==1)return false;
  const m=[...unique.values()][0];
  if(!scorePairMatches({...m,source,eventId:String(m.eventId)},game))return false;
  return {source,eventId:String(m.eventId),gameId:game.id,home:m.home,away:m.away,
    // The provider clock and period are informational, never independent
    // trade-entry requirements. Selected-period cushion uses Kalshi scores.
    period:m.period,seconds:m.remainingSeconds,elapsedMinute:NaN,
    live:m.live,periods:m.periods||[],
    period3:m.periods?.[2]?{home:m.periods[2].home,away:m.periods[2].away}:null};
};

// Returns verified reading, false for matched score contradiction/ambiguous
// identity, or null for coverage/unavailability. Never authorizes a trade.
export async function fetchIndependentMatchScore(game,milestone,{fetcher=fetch,espnFeed,foxFeed=null}={}){
  if(!game?.verifiedLive||!Number.isInteger(game.home)||!Number.isInteger(game.away)||
    !espnFeed||!Number.isFinite(Date.parse(milestone?.start_date||'')))return null;
  const dates=daysFor(Date.parse(milestone.start_date));
  const query=async(urls,source)=>{
    const results=await Promise.allSettled(urls.map(u=>pull(u,fetcher)));
    return select(results.filter(r=>r.status==='fulfilled').map(r=>r.value),game,milestone,source);
  };
  const espn=()=>query(espnScoreboardUrls(espnFeed,game,milestone,dates),'ESPN');
  const fox=async()=>{
    if(!foxFeed)return null;
    const prefix=`https://api.foxsports.com/bifrost/v1/${foxFeed}`;
    let urls;
    if(['nfl','cfb'].includes(foxFeed)){
      try{
        const summary=await pull(`${prefix}/league/scores?${foxQuery}`,fetcher);
        const selection=String(summary?.currentSelectionId||'');
        if(!/^\d{4}-\d{1,2}-\d$/.test(selection))return null;
        urls=[`${prefix}/league/scores-segment/${selection}?${foxQuery}${foxFeed==='cfb'?'&groupId=-4':''}`];
      }catch{return null;}
    }else urls=dates.map(day=>foxFeed==='soccer'?`${prefix}/scoreboard/segment/c0d${day}?${foxQuery}&groupId=0`:
      `${prefix}/league/scores-segment/${day}?${foxQuery}${foxFeed==='cbk'?'&groupId=-4':''}`);
    return query(urls,'FOX Sports');
  };
  return espnRetryThenFox({espn,fox});
}

// The two successful readings can come from different legitimate sources.
// A provider switch changes event IDs, not the Kalshi fixture identity.
export function pairedExternalMatch(first,second,game){
  if(!first?.eventId||!scorePairMatches(second,game))return false;
  if(first.source===second.source)return String(first.eventId)===String(second.eventId);
  return ['ESPN','FOX Sports'].includes(first.source)&&
    first.gameId===game.id&&second.gameId===game.id;
}