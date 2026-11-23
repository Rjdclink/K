import {supportedScannerSport} from './discovery.mjs';

const SCHEDULED_STATUSES=new Set(['scheduled','not_started','unplayed','pregame','pre_game','upcoming']);
const UNCONFIRMED_STATUSES=new Set(['live','inprogress','in_progress','playing','started']);
const HORIZON_MS=24*60*60*1000;

// A catalog's old "live" label is NOT authoritative game status. Render only
// recent listed fixtures; the score-verified live feed remains distinct.
export function upcomingScannedGames(milestones,{now=Date.now(),excludeIds=new Set(),limit=36}={}){
  if(!Array.isArray(milestones))return [];
  const found=new Map();
  for(const m of milestones){
    if(!m?.id||!m.title||!supportedScannerSport(m)||
       /(?:player|prop|stats?)/i.test(String(m.type||''))||excludeIds.has(m.id))continue;
    const status=String(m.details?.status||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    if(!SCHEDULED_STATUSES.has(status)&&!UNCONFIRMED_STATUSES.has(status))continue;
    const start=Date.parse(m.start_date||'');
    if(!Number.isFinite(start)||start>now+HORIZON_MS)continue;
    const family=String(m.type).split('_')[0];
    const priorLimit=(family==='football'?6:4)*3600000;
    if(start<now-priorLimit)continue;
    const waiting=start<=now||UNCONFIRMED_STATUSES.has(status);
    found.set(m.id,{
      id:m.id,title:m.title,sport:String(m.details?.league||family),
      sport_family:m.type,status:waiting?'awaiting':'scheduled',
      start_time:new Date(start).toISOString(),home:null,away:null,signals:[]
    });
  }
  // Bound the display by sport, not by global discovery order. Otherwise
  // a crowded hockey feed can hide every football or soccer fixture.
  const groups=new Map(['football','hockey','soccer'].map(f=>[f,[]]));
  for(const value of found.values())groups.get(value.sport_family.split('_')[0])?.push(value);
  const chosen=[];
  for(const group of groups.values()){
    group.sort((a,b)=>a.start_time.localeCompare(b.start_time)||
      a.title.localeCompare(b.title));
    chosen.push(...group.slice(0,Math.max(1,Math.ceil(limit/3))));
  }
  return chosen.sort((a,b)=>a.start_time.localeCompare(b.start_time)||
    a.title.localeCompare(b.title)).slice(0,Math.max(0,Math.floor(limit)));
}
