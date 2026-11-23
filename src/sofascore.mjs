import {scoreFeedAgeMs} from './score_feed_freshness.mjs';

const sports={soccer_:'football',hockey_:'ice-hockey',football_:'american-football'};
export function sofascoreSport(game){
  if(/esports/i.test(String(game?.type||'')))return null;
  return Object.entries(sports).find(([prefix])=>String(game?.type||'').startsWith(prefix))?.[1]||null;
}
const whole=n=>Number.isInteger(n)&&n>=0;
const phase=(event,sport)=>{
  const last=String(event?.lastPeriod||event?.time?.lastPeriod||'').toLowerCase();
  const description=String(event?.status?.description||'').toLowerCase();
  if(sport==='football')return /period2|2nd half|second half/.test(last+' '+description)?2:
    /period1|1st half|first half/.test(last+' '+description)?1:NaN;
  if(sport==='ice-hockey')return /period4|overtime|extra time/.test(last+' '+description)?4:
    /period3|3rd period|third period/.test(last+' '+description)?3:
    /period2|2nd period|second period/.test(last+' '+description)?2:
    /period1|1st period|first period/.test(last+' '+description)?1:NaN;
  return /period4|4th quarter|fourth quarter/.test(last+' '+description)?4:NaN;
};
export function parseSofascoreEvents(data,sport){
  if(!Array.isArray(data?.events))return [];
  return data.events.flatMap(event=>{
    const home=event?.homeScore?.current,away=event?.awayScore?.current;
    const start=event?.startTimestamp,period=phase(event,sport);
    if(!whole(home)||!whole(away)||!Number.isSafeInteger(start)||start<=0||
      !Number.isSafeInteger(event?.id)||!event?.homeTeam?.name||!event?.awayTeam?.name)return [];
    const periods=[];
    for(let i=1;i<=(sport==='ice-hockey'?4:3);i++){
      const h=event.homeScore?.['period'+i],a=event.awayScore?.['period'+i];
      if(!whole(h)||!whole(a))break;
      periods.push({number:i,home:h,away:a});
    }
    return [{source:'Sofascore',eventId:String(event.id),
      time:new Date(start*1000).toISOString(),homeAliases:[event.homeTeam.name,
        event.homeTeam.shortName].filter(Boolean),awayAliases:[event.awayTeam.name,
        event.awayTeam.shortName].filter(Boolean),home,away,period,
      periods:periods.length&&periods.reduce((n,p)=>n+p.home,0)===home&&
        periods.reduce((n,p)=>n+p.away,0)===away?periods:[],
      live:event.status?.type==='inprogress',seconds:NaN,elapsedMinute:NaN,
      tournament:event.tournament?.name||'',country:event.tournament?.category?.name||''}];
  });
}
export async function loadSofascore(game,milestone,{fetcher=fetch}={}){
  const sport=sofascoreSport(game),start=Date.parse(milestone?.start_date||'');
  if(!sport||!Number.isFinite(start))return null;
  const dates=[start,start-86400000,start+86400000]
    .map(ms=>new Date(ms).toISOString().slice(0,10));
  const replies=await Promise.allSettled(dates.map(async day=>{
    const response=await fetcher(`https://www.sofascore.com/api/v1/sport/${sport}/scheduled-events/${day}`,
      {cache:'no-store',headers:{accept:'application/json','x-requested-with':'XMLHttpRequest'},
        signal:AbortSignal.timeout(7000)});
    const sourceAgeMs=scoreFeedAgeMs(response);
    if(!response.ok||sourceAgeMs===null)throw Error('Sofascore unavailable or stale');
    const data=await response.json();
    return parseSofascoreEvents(data,sport).map(e=>({...e,sourceAgeMs}));
  }));
  return replies.some(r=>r.status==='fulfilled')?
    replies.flatMap(r=>r.status==='fulfilled'?r.value:[]):null;
}
