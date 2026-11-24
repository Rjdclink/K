// Full-game soccer/NHL NO timing, keyed to the exact goal line and current
// combined score. A clock window never replaces independent score checks.
export function isFullGameGoalTotal(game,market){
 const type=String(game?.type||game?.sport_family||''),soccer=type.startsWith('soccer_'),
  hockey=type.startsWith('hockey_');
 if(!soccer&&!hockey)return false;
 const series=String(market?.event_ticker||'').split('-')[0];
 return soccer?/^KX[A-Z0-9]+TOTAL$/.test(series)&&!/(?:TEAM|[1-4][HQPS]|HALF|PERIOD)TOTAL$/.test(series):
   series==='KXNHLTOTAL';
}
export function fullGameNoScoreAllowed(game,total){
 if(!Number.isInteger(total)||total<0||total>5)return false;
 if(total<4)return true;
 if(String(game.type||game.sport_family).startsWith('soccer_'))
   return game.period===2&&Number.isFinite(game.soccerMinute)&&game.soccerMinute>=85;
 return [3,4].includes(game.period)&&Number.isFinite(game.remainingSeconds)&&
   game.remainingSeconds>0&&game.remainingSeconds<=270;
}
export function goalNoWindow(game,market,total,{period='full_game'}={}){
 if(period!=='full_game'||!isFullGameGoalTotal(game,market)||
   !Number.isInteger(total)||total<0||total>5)return null;
 const soccer=String(game.type||game.sport_family).startsWith('soccer_');
 const line=Number(market?.floor_strike),gap=line-total;
 if(!Number.isFinite(line)||!Number.isFinite(gap)||gap<1.5)return null;
 // An exact 2.5 NO line may absorb one more goal only at zero or one scored.
 if(line===2.5&&total===1)return soccer?
   {firstSeconds:540,entrySeconds:480,waitSeconds:60}:
   {firstSeconds:360,entrySeconds:300,waitSeconds:60};
 if(gap>=2.5)
  return {firstSeconds:540,entrySeconds:480,waitSeconds:60};
 if(gap>=1.5&&gap<2.5){
  if(soccer)return {firstSeconds:60,entrySeconds:0,waitSeconds:60,stoppageOnly:true};
  return {firstSeconds:120,entrySeconds:60,waitSeconds:60};
 }
 return null;
}
