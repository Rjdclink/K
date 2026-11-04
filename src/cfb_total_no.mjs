import {espnMatches} from './score_verification.mjs';
import {collegeFootballTotalNo} from './no_strategy.mjs';

const clean=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');

export function independentCfbNoReading(scoreboard,summary,game,milestone,market){
  if(!collegeFootballTotalNo(game,market,{beforeWindow:true}))return false;
  const matches=espnMatches(scoreboard,game,milestone);
  if(matches.length!==1)return false;
  const reading=matches[0],event=scoreboard.events.find(e=>String(e.id)===String(reading.eventId));
  if(!reading.live||reading.home!==game.home||reading.away!==game.away||
    reading.period!==game.period||!Number.isFinite(reading.remainingSeconds)||
    Math.abs(reading.remainingSeconds-game.remainingSeconds)>10)return false;
  const competitors=event?.competitions?.[0]?.competitors||[];
  const situation=summary?.header?.competitions?.[0]?.situation||event?.competitions?.[0]?.situation;
  const holder=competitors.find(c=>String(c.id)===String(situation?.possession));
  const field=String(situation?.downDistanceText||'').match(/\bat\s+([A-Z][A-Z0-9]{1,7})\s+(\d{1,2})\b/i);
  const expected=game.footballSituation;
  if(!holder||!field||!expected||!Number.isInteger(expected.yardline)||
    Number(field[2])!==expected.yardline||expected.yardline>=50||
    clean(field[1])!==clean(holder.team?.abbreviation)||
    (holder.homeAway==='home'?'home':'away')!==game.possessionSide)return false;
  return {source:'ESPN',eventId:reading.eventId,home:reading.home,away:reading.away,
    period:reading.period,seconds:reading.remainingSeconds,side:field[1],yardline:Number(field[2]),
    possession:holder.team?.displayName};
}

export async function verifyIndependentCfbNo(game,milestone,market,{fetcher=fetch}={}){
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start))return null;
  const dates=[start,start-86400000].map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
  for(const date of new Set(dates)){
    const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&limit=500`;
    const response=await fetcher(url,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)continue;
    const scoreboard=await response.json(),matches=espnMatches(scoreboard,game,milestone);
    if(matches.length!==1)continue;
    const summaryUrl=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(matches[0].eventId)}`;
    const summaryResponse=await fetcher(summaryUrl,{signal:AbortSignal.timeout(6000)});
    if(!summaryResponse.ok)return null;
    return independentCfbNoReading(scoreboard,await summaryResponse.json(),game,milestone,market)||null;
  }
  return null;
}
