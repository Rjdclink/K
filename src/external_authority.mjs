// A single independently identified fixture controls sporting scores; Kalshi
// remains responsible for contractual terms, executable quotes and cash.
// This conversion never creates a verified fixture from a Kalshi-only reading.
const sources=new Set(['ESPN','FOX Sports','Sofascore']);
const whole=n=>Number.isInteger(n)&&n>=0;
export const EXTERNAL_GAME_FRESH_MS=15000;
export function authoritativeGameState(game,reading,now=Date.now()){
 if(!game||!game.verifiedLive||!sources.has(reading?.source)||
   !String(reading?.eventId||'').trim()||reading.gameId!==game.id||
   reading.live!==true||!whole(reading.home)||!whole(reading.away)||
   Number.isInteger(game.period)&&Number.isInteger(reading.period)&&reading.period!==game.period)return null;
 if(!Number.isFinite(now))return null;
 let periods=null;
 if(Array.isArray(reading.periods)&&reading.periods.length){
  periods=[];
  const unique=new Set();
  for(const raw of reading.periods){
   if(!whole(raw?.number)||raw.number<1||unique.has(raw.number)||
     !whole(raw.home)||!whole(raw.away))return null;
   unique.add(raw.number);
   periods.push({number:raw.number,home:raw.home,away:raw.away});
  }
  periods.sort((a,b)=>a.number-b.number);
  if(periods.some((part,index)=>part.number!==index+1))return null;
  if(Number.isInteger(game.period)&&periods.length>game.period)return null;
  if(periods.reduce((n,p)=>n+p.home,0)!==reading.home||
     periods.reduce((n,p)=>n+p.away,0)!==reading.away)return null;
 }
 const score={source:reading.source,eventId:String(reading.eventId),gameId:game.id,
  home:reading.home,away:reading.away,period:reading.period,periods,
  checkedAt:now-(Number.isFinite(reading.sourceAgeMs)?reading.sourceAgeMs:0),live:true};
 const result={...game,home:score.home,away:score.away,
  homeUnits:score.home,awayUnits:score.away,scoreKnown:true,scoreConsistent:true,
  periodConsistent:periods?true:game.periodConsistent,
  externalScore:score,kalshiScore:{home:game.home,away:game.away}};
 if(periods)result.periodScores=periods;
 if(/soccer/.test(String(game.type||''))&&Number.isFinite(reading.elapsedMinute)&&
   reading.elapsedMinute>=0&&reading.elapsedMinute<=180){
   result.soccerMinute=reading.elapsedMinute;
   result.matchRemainingSeconds=Math.max(0,Math.round((90-reading.elapsedMinute)*60));
 }
 if(/hockey|basketball|football/.test(String(game.type||''))&&
   Number.isFinite(reading.seconds)&&reading.seconds>=0&&reading.seconds<=3600)
   result.remainingSeconds=reading.seconds;
 return result;
}
export function verifiedSourceReady(game,now=Date.now()){
 const s=game?.externalScore;
 return Boolean(sources.has(s?.source)&&s?.eventId&&s.gameId===game?.id&&
   s.live===true&&whole(s.home)&&whole(s.away)&&
   Number.isFinite(s.checkedAt)&&now>=s.checkedAt&&
   now-s.checkedAt<=EXTERNAL_GAME_FRESH_MS);
}
export function externalStatScore(game,proof,player){
 if(!sources.has(proof?.source)||!proof?.eventId||proof.gameId!==game?.id||
   !player?.id||proof.playerId!==player.id||proof.metric!==player.metric||
   !whole(proof.playerValue)||!Number.isFinite(player.line)||proof.playerValue<=player.line)return null;
 return proof.playerValue;
}
