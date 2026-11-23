// Purchase-only rule. Hockey and soccer cannot place ANY new game position
// until the actual game is inside its final five minutes, regardless of an
// earlier period/half market or an otherwise qualifying commanding lead.
// Do not apply to settlement, held-position monitoring, or reduce-only exits.
export const FINAL_FIVE_SECONDS=300;

export function finalFiveEntryEligible(game){
 const family=String(game?.type||game?.sport_family||'').toLowerCase();
 const soccer=family.startsWith('soccer_'),hockey=family.startsWith('hockey_');
 if(!soccer&&!hockey)return true;
 if(game?.verifiedLive!==true||game?.scoreKnown!==true||
   game?.periodConsistent!==true||game?.clockRunning===false)return false;
 if(hockey){
   // P1/P2 end in an intermission; they are not game-ending windows.
   // P4 is an actual overtime segment when the provider reports one.
   return [3,4].includes(Number(game.period))&&
     Number.isFinite(game.remainingSeconds)&&game.remainingSeconds>0&&
     game.remainingSeconds<=FINAL_FIVE_SECONDS;
 }
 if(Number(game.period)!==2||game.soccerExtraTime===true||
   game.soccerOvertime===true||!Number.isFinite(game.soccerMinute))return false;
 const minute=game.soccerMinute,remaining=Math.round((90-minute)*60);
 // The 90:00 marker itself does not prove that play is continuing.
 if(minute>90)return minute<=180&&game.matchRemainingSeconds===0;
 if(minute<85||minute>=90||remaining<=0||remaining>FINAL_FIVE_SECONDS)return false;
 // Do not trust contradictory, invalid or fabricated source-clock fields.
 if(game.matchRemainingSeconds!=null&&(
   !Number.isFinite(game.matchRemainingSeconds)||
   Math.abs(game.matchRemainingSeconds-remaining)>90))return false;
 return true;
}

export function assertFinalFiveEntry(entries){
 const visited=new Set();
 function check(entry,depth=0){
   const game=entry?.game||entry?.state||entry;
   const market=entry?.market;
   if(depth>32||!game||typeof game!=='object'||visited.has(game))
     throw Object.assign(Error('Unverifiable nested purchase leg'),
       {code:'LOCAL_FINAL_FIVE_WINDOW_REQUIRED'});
   visited.add(game);
   if(!finalFiveEntryEligible(game)){
     const family=String(game?.type||game?.sport_family||'').toLowerCase();
     throw Object.assign(
       Error('New '+(family.startsWith('soccer_')?'soccer':'hockey')+
         ' position blocked: entry is allowed only within the final five minutes of the game'),
       {code:'LOCAL_FINAL_FIVE_WINDOW_REQUIRED'});
   }
   const components=game.entryComponents;
   if(Array.isArray(market?.mve_selected_legs)&&market.mve_selected_legs.length>1&&
     (!Array.isArray(components)||components.length!==market.mve_selected_legs.length))
     throw Object.assign(Error('Combined purchase has no fully verified timed components'),
       {code:'LOCAL_FINAL_FIVE_WINDOW_REQUIRED'});
   if(Array.isArray(components))for(const component of components)check(component,depth+1);
   visited.delete(game);
 }
 for(const entry of entries||[])check(entry);
}
