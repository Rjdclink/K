import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo} from './no_strategy.mjs';

const qualifies=(game,market)=>game.sport==='CFB'?collegeFootballTotalNo(game,market,{beforeWindow:true}):
  collegeBasketballTotalNo(game,market,{beforeWindow:true});

export function independentCollegeTotalNoReading(scoreboard,game,milestone,market){
  if(!qualifies(game,market))return false;
  const matches=espnMatches(scoreboard,game,milestone);
  return collegeTotalNoReading(matches,game);
}
function collegeTotalNoReading(matches,game){
  if(matches.length!==1)return false;
  const reading=matches[0];
  if(!reading.live||reading.home!==game.home||reading.away!==game.away||
    reading.period!==game.period||!Number.isFinite(reading.remainingSeconds)||
    Math.abs(reading.remainingSeconds-game.remainingSeconds)>10)return false;
  return {source:'ESPN',eventId:reading.eventId,home:reading.home,away:reading.away,
    period:reading.period,seconds:reading.remainingSeconds};
}

export async function verifyIndependentCollegeTotalNo(game,milestone,market,{fetcher=fetch}={}){
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start)||!qualifies(game,market))return null;
  const dates=[start,start-86400000].map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
  for(const date of new Set(dates)){
    const feed=game.sport==='CFB'?'football/college-football':game.sport==='NCAAB'? 'basketball/mens-college-basketball':
      game.sport==='NCAAW'?'basketball/womens-college-basketball':null;
    if(!feed)return null;
    const results=await Promise.allSettled(espnScoreboardUrls(feed,game,milestone,[date]).map(async url=>{
      const response=await fetcher(url,{signal:AbortSignal.timeout(6000)});
      return response.ok?espnMatches(await response.json(),game,milestone):[];
    }));
    const matches=[...new Map(results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value)
      .map(m=>[JSON.stringify(m),m])).values()];
    // An identified disagreement or ambiguous fixture must not shop dates.
    if(matches.length)return collegeTotalNoReading(matches,game)||null;
  }
  return null;
}
