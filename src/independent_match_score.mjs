import {espnMatches,foxMatches,sameFixture} from './score_verification.mjs';
import {loadSportradar} from './sportradar.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {espnRetryThenFox} from './source_fallback.mjs';

let activeFixtureCache=null;
export function configureIndependentFixtureCache(cache){activeFixtureCache=cache||null;}


// These are site-facing public scoreboard formats already used by K. A source
// with no exact fixture is unavailable, not verification. A matched fixture
// with a conflicting score is a veto, never permission to try another source.
const FOX_PUBLIC_KEY='jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq';
const foxQuery=`apikey=${FOX_PUBLIC_KEY}&api-version=1.1`;
// An independent provider is the score authority. Kalshi supplies timing,
// contract identity, liquidity and execution, never an equality veto here.
export const scorePairMatches=(reading,game)=>Boolean(
  ['ESPN','FOX Sports','Sportradar'].includes(reading?.source)&&reading.eventId&&
  (reading.source!=='Sportradar'||/^sr:(?:sport_event|match):\d+$/.test(String(reading.eventId))&&reading.gameId===game?.id)&&
  Number.isInteger(reading.home)&&reading.home>=0&&
  Number.isInteger(reading.away)&&reading.away>=0&&
  (!reading.gameId||reading.gameId===game?.id));

const daysFor=start=>[start,start-86400000,start+86400000]
  .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
const pull=async(url,fetcher)=>{
  const response=await fetcher(url,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('Scoreboard unavailable');
  return response.json();
};
// An event ID confirmed on an earlier verified score can disambiguate new
// provider nicknames. It never supplies a cached score, clock or permission
// to enter: provider scoreboard must still return the same event and current
// matching home/away scores on every check.
const cachedEvent=(boards,source,id,game,milestone)=>{
  if(!id)return null;
  const items=source==='ESPN'?boards.flatMap(b=>b?.events||[])
    .filter(e=>String(e?.id)===id)
    .map(e=>{
      const c=e.competitions?.[0],home=c?.competitors?.find(t=>t.homeAway==='home'),away=c?.competitors?.find(t=>t.homeAway==='away');
      if(!home||!away)return null;
      const periods=(home.linescores||[]).map((p,i)=>({number:i+1,home:Number(p.value),away:Number(away.linescores?.[i]?.value)}));
      return {eventId:id,time:e.date,home:Number(home.score),away:Number(away.score),
        periods,period:Number(c.status?.period||e.status?.period),live:c.status?.type?.state==='in'};
    }):boards.flatMap(b=>b?.sectionList||[]).flatMap(section=>section?.events||[])
    .filter(e=>String(e.entityLink?.layout?.tokens?.id||'')===id)
    .map(e=>{
      const token=e.entityLink?.layout?.tokens||{},teams=[e.upperTeam,e.lowerTeam];
      const home=teams.find(t=>token.homeUri&&t?.uri===token.homeUri),
        away=teams.find(t=>token.awayUri&&t?.uri===token.awayUri);
      if(!home||!away||home===away)return null;
      return {eventId:id,time:e.eventTime,home:Number(home.score),away:Number(away.score),
        periods:[],period:NaN,live:e.eventStatus===1};
    });
  const valid=items.filter(Boolean);
  if(!valid.length)return null;
  const start=Date.parse(milestone?.start_date||'');
  if(!Number.isFinite(start)||valid.some(m=>!Number.isFinite(Date.parse(m.time))||
    Math.abs(start-Date.parse(m.time))>3*3600_000)||
    valid.some(m=>m.home!==valid[0].home||m.away!==valid[0].away))return false;
  if(!scorePairMatches({...valid[0],source,eventId:id},game))return false;
  return {source,eventId:id,gameId:game.id,home:valid[0].home,away:valid[0].away,
    periods:valid[0].periods,period:valid[0].period,live:valid[0].live,
    seconds:NaN,elapsedMinute:NaN,
    period3:valid[0].periods?.[2]?
      {home:valid[0].periods[2].home,away:valid[0].periods[2].away}:null};
};
const select=(boards,game,milestone,source,knownId=null)=>{
  const cached=cachedEvent(boards,source,knownId,game,milestone);
  if(cached!==null)return cached;
  const matches=boards.flatMap(b=>source==='ESPN'?espnMatches(b,game,milestone,{identityOnly:true}):
    foxMatches(b,game,milestone,{identityOnly:true}));
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
export async function fetchIndependentMatchScore(game,milestone,{fetcher=fetch,espnFeed,foxFeed=null,fixtureCache=activeFixtureCache,sportradarLoad=loadSportradar}={}){
  if(!game?.verifiedLive||!Number.isInteger(game.home)||!Number.isInteger(game.away)||
    !espnFeed||!Number.isFinite(Date.parse(milestone?.start_date||'')))return null;
  const dates=daysFor(Date.parse(milestone.start_date));
  const known=new Map();
  const query=async(urls,source)=>{
    let id=known.get(source);
    if(!known.has(source)){
      try{id=fixtureCache?await fixtureCache.get(game,milestone,source):null}
      catch{id=null} // A cache outage cannot fabricate verification or block fresh source matching.
      known.set(source,id||null);
    }
    const results=await Promise.allSettled(urls.map(u=>pull(u,fetcher)));
    const reading=select(results.filter(r=>r.status==='fulfilled').map(r=>r.value),game,milestone,source,id);
    if(reading&&reading!==false&&fixtureCache){
      try{if(await fixtureCache.put(game,milestone,source,reading.eventId)===false)return false}
      catch{} // The current independently matched scoreboard remains authoritative.
    }
    return reading;
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
  const matched=await espnRetryThenFox({espn,fox});
  // A provider contradiction remains a veto. Only unavailable ESPN/FOX
  // sources can advance to the authenticated, live Sportradar soccer feed.
  if(matched!==null||!/soccer/.test(String(game.type||'')))return matched;
  let readings;
  try{
    readings=await sportradarLoad(game,milestone,{
      fetcher,matchFixture:(home,away,time)=>sameFixture(game,milestone,home,away,time)
    });
  }catch{return null}
  if(readings?.ambiguous)return false;
  if(!Array.isArray(readings))return null;
  const candidates=readings.filter(reading=>sameFixture(game,milestone,
    reading?.homeAliases||[],reading?.awayAliases||[],reading?.time));
  if(candidates.length>1)return false;
  if(candidates.length!==1)return null;
  const reading=candidates[0],eventId=String(reading.eventId||'');
  if(!/^sr:(?:sport_event|match):\d+$/.test(eventId))return null;
  if(reading.live!==true)return reading.live===false?false:null;
  if(!Number.isInteger(reading.home)||reading.home<0||
     !Number.isInteger(reading.away)||reading.away<0)return null;
  return {source:'Sportradar',eventId,gameId:game.id,
    home:reading.home,away:reading.away,period:reading.period,
    periods:Array.isArray(reading.periods)?reading.periods:[],live:true};

}

// The two successful readings can come from different legitimate sources.
// A provider switch changes event IDs, not the Kalshi fixture identity.
export function pairedExternalMatch(first,second,game){
  if(!scorePairMatches(first,game)||!scorePairMatches(second,game)||
    second.home<first.home||second.away<first.away)return false;
  if(first.source===second.source)return String(first.eventId)===String(second.eventId);
  return ['ESPN','FOX Sports','Sportradar'].includes(first.source)&&
    first.gameId===game.id&&second.gameId===game.id;
}