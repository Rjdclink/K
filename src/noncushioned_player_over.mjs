import {playerOverSpec,playerPropEarlyWindow,overSignal,variableValuePlayerMetric} from './strategy.mjs';
import {sportsContractKey} from './entry_verification.mjs';
import {espnMatches,foxMatches,playerStatValue,foxPlayerStat} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {espnRetryThenFox} from './source_fallback.mjs';

export const FIRST_NONCUSHIONED_CHECK_MS=210000;
export function rankNoncushionedReplacements(entries){
 return entries.filter(e=>e&&Number.isFinite(e.netProfitCents)&&e.netProfitCents>=50&&
   Number.isFinite(e.costCents)&&e.costCents>0)
  .sort((a,b)=>b.netProfitCents-a.netProfitCents||
    String(a.ticker||a.c?.market?.ticker||'').localeCompare(String(b.ticker||b.c?.market?.ticker||'')));
}

const statField={REB:'rebounds',AST:'assists','3PT':'three_points_made',STL:'steals',BLK:'blocks',
 GOALS:'goals',SAVES:'saves',SOG:'shots_on_goal',HITS:'hits',HR:'home_runs'};
const feedBySport={NBA:'basketball/nba',WNBA:'basketball/wnba',NCAAB:'basketball/mens-college-basketball',
 NCAAW:'basketball/womens-college-basketball',NFL:'football/nfl',CFB:'football/college-football',
 NHL:'hockey/nhl',MLB:'baseball/mlb'};
export function uncushionedPlayerSpec(game,market){
 // The contract itself identifies the player and statistic, even before
 // Kalshi publishes a player-stat snapshot. The external boxscore must still
 // prove the named statistic; no missing Kalshi value authorizes a trade.
 let player=playerOverSpec(game,market);
 if(!player&&game&&market){
  const family=String(game.type||'');
  const metric=String(market.event_ticker||'').split('-')[0]
    .match(/(REB|AST|3PT|STL|BLK|GOALS|SAVES|SOG|HITS|HR)$/)?.[1];
  const fields=Object.entries(market.custom_strike||{})
    .filter(([key,value])=>key.endsWith('_player')&&typeof value==='string'&&value);
  const selected=fields.length===1?fields[0]:null;
  const label=String(market.yes_sub_title||market.title||'');
  const shown=label.match(/^([^:]+):\s*(\d+)\s*\+/);
  const line=Number(market.floor_strike);
  if(metric&&selected&&family.startsWith(selected[0].replace(/_player$/,'')+'_')&&
    shown&&Number.isFinite(line)&&line>=0&&Number(shown[2])===line+.5&&
    ['greater','greater_than'].includes(market.strike_type)&&
    market.ticker?.startsWith(String(market.event_ticker||'')+'-'))
    player={id:selected[1],name:shown[1].trim(),metric,line,value:0};
 }
 if(!player||!playerPropEarlyWindow(game)||variableValuePlayerMetric(player.metric)||
  !statField[player.metric]||!feedBySport[game.sport]||
  !['active','open'].includes(market.status)||!market.ticker?.startsWith(market.event_ticker+'-'))return null;
 return {player,feed:feedBySport[game.sport],key:sportsContractKey(game,market)};
}
export function noncushionedPlayerState(game,market,reading){
 const spec=uncushionedPlayerSpec(game,market),p=spec?.player;
 if(!p||!reading||reading.gameId!==game.id||reading.playerId!==p.id||
  reading.metric!==p.metric||!reading.eventId||!['ESPN','FOX Sports'].includes(reading.source)||
  game?.externalScore?.source===reading.source&&
    String(game.externalScore.eventId)!==String(reading.eventId)||
  !Number.isInteger(reading.playerValue)||reading.playerValue<=p.line)return null;
 const result={...game,playerStats:{...game.playerStats,
  [p.id]:{...game.playerStats[p.id],[statField[p.metric]]:reading.playerValue}}};
 return overSignal(result,market)?result:null;
}
export function noncushionedTwoProofs(first,second,game,market,now=Date.now(),firstSeen=null){
 const spec=uncushionedPlayerSpec(game,market);
 if(!spec||!first||!second||first.gameId!==game.id||second.gameId!==game.id||
  first.playerId!==spec.player.id||second.playerId!==spec.player.id||
  first.metric!==spec.player.metric||second.metric!==spec.player.metric||
  first.contractKey!==spec.key||second.contractKey!==spec.key||
  !first.eventId||first.source!==second.source||first.eventId!==second.eventId||
  !Number.isInteger(first.playerValue)||!Number.isInteger(second.playerValue)||
  first.playerValue<=spec.player.line||second.playerValue<first.playerValue||
  !Number.isFinite(first.requestedAt)||!Number.isFinite(second.requestedAt)||
  second.requestedAt<=first.requestedAt||second.requestedAt>now||
  firstSeen!==null&&(!Number.isFinite(firstSeen)||
    first.requestedAt-firstSeen<FIRST_NONCUSHIONED_CHECK_MS)||
  now-second.requestedAt>10000)return false;
 return Boolean(noncushionedPlayerState(game,market,second));
}
export async function verifyNoncushionedPlayerStat(game,milestone,market,{fetcher=fetch,now=Date.now}={}){
 const spec=uncushionedPlayerSpec(game,market);
 if(!spec||!Number.isFinite(Date.parse(milestone?.start_date||'')))return null;
 const days=[0,-1,1].map(d=>new Date(Date.parse(milestone.start_date)+d*86400000)
   .toISOString().slice(0,10).replaceAll('-',''));
 const read=async url=>{const r=await fetcher(url,{cache:'no-store',
   signal:AbortSignal.timeout(6500)});if(!r.ok)throw Error('Unusable score provider');return r.json()};
 const espn=async()=>{
  const boards=(await Promise.allSettled(espnScoreboardUrls(spec.feed,game,milestone,days).map(read)))
   .filter(r=>r.status==='fulfilled').map(r=>r.value);
  const matches=new Map();
  for(const board of boards)for(const m of espnMatches(board,game,milestone,{identityOnly:true}))
   if(m.eventId)matches.set(String(m.eventId),m);
  if(!matches.size)return null;
  if(matches.size!==1)return false;
  const m=[...matches.values()][0];if(m.live===false)return false;
  let summary;
  try{summary=await read('https://site.api.espn.com/apis/site/v2/sports/'+spec.feed+
    '/summary?event='+encodeURIComponent(m.eventId))}catch{return null}
  const value=playerStatValue(summary,spec.player);
  if(value===null)return null;
  return {source:'ESPN',eventId:String(m.eventId),gameId:game.id,
   playerId:spec.player.id,metric:spec.player.metric,playerValue:value,
   contractKey:spec.key,requestedAt:now()};
 };
 const fox=async()=>{
  const feed={NBA:'nba',WNBA:'wnba',NHL:'nhl',NFL:'nfl',CFB:'cfb',MLB:'mlb'}[game.sport];
  if(!feed)return null;
  const root='https://api.foxsports.com/bifrost/v1/'+feed,api='apikey=jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq&api-version=1.1';
  let segments=days;
  if(['nfl','cfb'].includes(feed)){
   let selections;try{selections=await read(root+'/league/scores?'+api)}catch{return null}
   const id=String(selections?.currentSelectionId||'');
   if(!/^\d{4}-\d{1,2}-\d$/.test(id))return null;
   segments=[id];
  }
  const boards=(await Promise.allSettled(segments.map(d=>read(root+'/league/scores-segment/'+d+'?'+api+
   (['cfb','cbk'].includes(feed)?'&groupId=-4':'')))))
   .filter(r=>r.status==='fulfilled').map(r=>r.value);
  const matches=new Map();
  for(const board of boards)for(const m of foxMatches(board,game,milestone,{identityOnly:true}))
   if(m.eventId)matches.set(String(m.eventId),m);
  if(!matches.size)return null;
  if(matches.size!==1)return false;
  const m=[...matches.values()][0];if(m.live===false)return false;
  let detail;try{detail=await read(root+'/event/'+encodeURIComponent(m.eventId)+'/data?'+api)}
  catch{return null}
  const value=foxPlayerStat(detail,spec.player,m.eventId);
  if(value===null)return null;
  return {source:'FOX Sports',eventId:String(m.eventId),gameId:game.id,
   playerId:spec.player.id,metric:spec.player.metric,playerValue:value,
   contractKey:spec.key,requestedAt:now()};
 };
 const reading=await espnRetryThenFox({espn,fox});
 return reading&&reading!==false?reading:null;
}
