// Full-game soccer/NHL NO timing, keyed to the exact goal line and current
// combined score. A clock window never replaces independent score checks.
export function goalNoWindow(game,market,total,{period='full_game'}={}){
 const type=String(game?.type||game?.sport_family||''),soccer=type.startsWith('soccer_'),
  hockey=type.startsWith('hockey_');
 if((!soccer&&!hockey)||period!=='full_game'||!Number.isInteger(total)||total<0||total>4)
  return null;
 const series=String(market?.event_ticker||'').split('-')[0];
 if(soccer?!/^KX[A-Z0-9]+TOTAL$/.test(series)||/(?:TEAM|[1-4][HQPS]|HALF|PERIOD)TOTAL$/.test(series):
   series!=='KXNHLTOTAL')return null;
 const line=Number(market?.floor_strike),gap=line-total;
 if(!Number.isFinite(line)||!Number.isFinite(gap)||gap<=0)return null;
 if(line===3.5&&total===3)return {firstSeconds:960,entrySeconds:900,waitSeconds:60};
 if(line===2.5&&total===2||gap>=2.5)
  return {firstSeconds:540,entrySeconds:480,waitSeconds:60};
 if(gap>=1.5&&gap<2.5){
  if(soccer)return {firstSeconds:60,entrySeconds:0,waitSeconds:60,stoppageOnly:true};
  return {firstSeconds:120,entrySeconds:60,waitSeconds:60};
 }
 return null;
}
