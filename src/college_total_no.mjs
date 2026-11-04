import {espnMatches} from './score_verification.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo} from './no_strategy.mjs';

const qualifies=(game,market)=>game.sport==='CFB'?collegeFootballTotalNo(game,market,{beforeWindow:true}):
  collegeBasketballTotalNo(game,market,{beforeWindow:true});

export function independentCollegeTotalNoReading(scoreboard,game,milestone,market){
  if(!qualifies(game,market))return false;
  const matches=espnMatches(scoreboard,game,milestone);
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
  if(!Number.isFinite(start))return null;
  const dates=[start,start-86400000].map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
  for(const date of new Set(dates)){
    const feed=game.sport==='CFB'?'football/college-football':game.sport==='NCAAB'? 'basketball/mens-college-basketball':
      game.sport==='NCAAW'?'basketball/womens-college-basketball':null;
    if(!feed)return null;
    const url=`https://site.api.espn.com/apis/site/v2/sports/${feed}/scoreboard?dates=${date}&limit=500`;
    const response=await fetcher(url,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)continue;
    const scoreboard=await response.json(),reading=independentCollegeTotalNoReading(scoreboard,game,milestone,market);
    if(reading)return reading;
  }
  return null;
}
