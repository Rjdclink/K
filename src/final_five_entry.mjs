// Purchase-only rule. Hockey, soccer and football enter late in the actual
// game; verified soccer commanding winners have score-specific early windows.
// Earlier period/half markets cannot use their segment clocks.
// Do not apply to settlement, held-position monitoring, or reduce-only exits.
export const FINAL_FIVE_SECONDS=300;

// Purchase-only goal ceiling. Soccer commanding winners permit exactly five;
// all other soccer/hockey purchases stay below five. Both score feeds can veto.
const GOAL_ENTRY_CEILING=5;
const validGoals=score=>Number.isInteger(score?.home)&&score.home>=0&&
  Number.isInteger(score?.away)&&score.away>=0;
const scoreTotal=score=>score.home+score.away;
export function goalScoreBelowFive(game,now=Date.now(),{soccerLead=false}={}){
  const family=String(game?.type||game?.sport_family||'').toLowerCase();
  if(!family.startsWith('soccer_')&&!family.startsWith('hockey_'))return true;
  const proof=game?.independentEntry?.score||game?.externalScore;
  const all=[game,game?.kalshiScore,game?.externalScore,game?.independentEntry?.score];
  // A missing or malformed game score cannot prove the ceiling; the
  // independently matched fixture and freshness must also be known.
  const ceiling=soccerLead&&family.startsWith('soccer_')?6:GOAL_ENTRY_CEILING;
  if(!validGoals(game)||all.some(score=>score&&validGoals(score)&&
    scoreTotal(score)>=ceiling))return false;
  return Boolean(validGoals(proof)&&['ESPN','FOX Sports','BBC Sport','NHL','NFL'].includes(proof.source)&&
    String(proof.eventId||'').trim()&&proof.gameId===game.id&&
    Number.isFinite(proof.checkedAt)&&now>=proof.checkedAt&&
    now-proof.checkedAt<=15000&&scoreTotal(proof)<ceiling);
}

export function finalFiveEntryEligible(game,{strategy,market}={}){
 const family=String(game?.type||game?.sport_family||'').toLowerCase();
 const soccer=family.startsWith('soccer_'),hockey=family.startsWith('hockey_'),
   football=family.startsWith('football_');
 if(!soccer&&!hockey&&!football)return true;
 if(game?.verifiedLive!==true||game?.scoreKnown!==true||
   game?.periodConsistent!==true||game?.clockRunning===false)return false;
 const winnerMarket=market&&/GAME(?:-|$)/.test(String(market.event_ticker||''));
 const lead=Boolean(winnerMarket&&(strategy==='lead'||game?.leadVerification));
 const margin=Math.abs(Number(game?.homeUnits??game?.home)-Number(game?.awayUnits??game?.away));
 const total=Number(game?.home)+Number(game?.away);
 const goalExtension=lead&&Number.isInteger(game?.home)&&Number.isInteger(game?.away)&&
   margin>=3&&total<5;
 const soccerFiveLead=lead&&soccer&&margin>=3&&total===5;
 const limit=soccerFiveLead?570:goalExtension?(soccer?930:margin===3?420:FINAL_FIVE_SECONDS):FINAL_FIVE_SECONDS;
 if(hockey||football){
   // P1/P2 end in an intermission; they are not game-ending windows.
   // P4 is an actual overtime segment when the provider reports one.
   return (football?Number(game.period)===4:[3,4].includes(Number(game.period)))&&
     Number.isFinite(game.remainingSeconds)&&game.remainingSeconds>0&&
     game.remainingSeconds<(football?FINAL_FIVE_SECONDS:limit);
 }
 if(Number(game.period)!==2||game.soccerExtraTime===true||
   game.soccerOvertime===true||!Number.isFinite(game.soccerMinute))return false;
 const minute=game.soccerMinute,remaining=Math.round((90-minute)*60);
 // The 90:00 marker itself does not prove that play is continuing.
 if(minute>90)return minute<=180&&game.matchRemainingSeconds===0;
 if(minute>=90||remaining<=0||remaining>=limit)return false;
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
   if(!finalFiveEntryEligible(game,{market})){
     const family=String(game?.type||game?.sport_family||'').toLowerCase();
     throw Object.assign(
       Error('New '+(family.startsWith('soccer_')?'soccer':family.startsWith('hockey_')?'hockey':'football')+
         ' position blocked: entry is outside its final-game clock window'),
       {code:'LOCAL_FINAL_FIVE_WINDOW_REQUIRED'});
   }
   const soccerLead=String(game.type||game.sport_family||'').startsWith('soccer_')&&
     /GAME(?:-|$)/.test(String(market?.event_ticker||''))&&Boolean(game.leadVerification)&&
     Math.abs(Number(game.home)-Number(game.away))>=3;
   if(!goalScoreBelowFive(game,Date.now(),{soccerLead}))throw Object.assign(
     Error('New soccer/hockey position blocked: combined game score exceeds its entry limit'),
     {code:'LOCAL_GOAL_SCORE_LIMIT'});
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
