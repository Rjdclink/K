import {supportedScannerSport} from './discovery.mjs';

// Scoreboard observations are monitoring information, never contract proof.
const SOURCES=new Set(['ESPN','FOX Sports','BBC Sport','NHL','NFL']);
const whole=n=>Number.isInteger(n)&&n>=0;
const pad=n=>String(Math.floor(n)).padStart(2,'0');
const formatted=seconds=>pad(seconds/60)+':'+pad(seconds%60);

export function normalizeScannerExternalObservation(game,reading,now=Date.now()){
 const {milestone,state}=game;
 const base={game_id:milestone.id,sport_family:milestone.type,checked_at:new Date(now).toISOString(),
  status:'unavailable',source:null,event_id:null,home:null,away:null,period:null,
  clock_seconds:null,elapsed_minute:null,time_left:null,reason:null};
 if(reading===false)return {...base,status:'conflict',reason:'Contradictory or ambiguous independent fixture'};
 if(!reading)return {...base,reason:'No exactly matched independent scoreboard fixture'};
 const source=String(reading.source||''),id=String(reading.eventId||'');
 if(!SOURCES.has(source)||!id||reading.gameId!==state.id||
   !whole(reading.home)||!whole(reading.away)||
   (Number.isFinite(reading.sourceAgeMs)&&(reading.sourceAgeMs<0||reading.sourceAgeMs>15000)))
  return {...base,reason:'Independent provider identity, score or freshness invalid'};
 if(reading.live!==true)return {...base,status:'not_live',source,event_id:id,
  reason:'Exact fixture is not currently reported live by the external provider'};
 const period=reading.period;
 const seconds=reading.seconds,minute=reading.elapsedMinute;
 const soccer=String(milestone.type||'').startsWith('soccer_');
 const periodValid=Number.isInteger(period)&&period>=1&&period<=(soccer?4:6);
 const clockValid=soccer?Number.isFinite(minute)&&minute>=0&&minute<=180:
   Number.isFinite(seconds)&&seconds>=0&&seconds<=3600;
 if(!periodValid||!clockValid)return {...base,status:'no_clock',source,event_id:id,
  reason:'External live score matched, but period or independent game clock is unavailable'};
 const remaining=soccer?Math.max(0,Math.round((90-minute)*60)):seconds;
 const label=soccer?formatted(remaining)+' match time remaining':
  (String(milestone.type).startsWith('football_')?'Quarter':'Period')+' '+period+' · '+formatted(remaining)+' remaining';
 return {...base,status:'live',source,event_id:id,home:reading.home,away:reading.away,
  period,clock_seconds:remaining,elapsed_minute:soccer?minute:null,time_left:label,reason:null};
}

export function promotedFromExternalObservation(game,observation){
 if(observation?.status!=='live'||observation.game_id!==game?.milestone?.id)return game;
 return {...game,state:{...game.state,
  // Scheduling only: fast scanner reloads Kalshi and separately proves entry.
  verifiedLive:true,period:observation.period,
  remainingSeconds:observation.clock_seconds,
  soccerMinute:observation.elapsed_minute??game.state.soccerMinute}};
}

export async function nearScanExternalObservations(games,{verify,now=Date.now,concurrency=12}={}){
 const items=games.filter(g=>supportedScannerSport(g?.milestone));
 const results=new Array(items.length);
 let next=0;
 await Promise.all(Array.from({length:Math.min(items.length,Math.max(1,concurrency))},
  async()=>{while(next<items.length){
   const i=next++,game=items[i];
   let reading=null,issue=null;
   try{reading=await verify(game)}catch(error){issue=String(error?.message||error).slice(0,180)}
   const result=normalizeScannerExternalObservation(game,reading,now());
   results[i]=issue?{...result,reason:issue}:result;
  }}));
 return results;
}
