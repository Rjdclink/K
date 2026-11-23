// Independently identified ESPN/FOX scoreboard is authoritative for NO
// scoring cushions. The Kalshi game state remains authoritative for the
// contract, period and entry clock. This helper never identifies a fixture:
// only fetchIndependentMatchScore can supply a verified source/event pair.
export function externalNoScore(game,reading){
 if(!['ESPN','FOX Sports','BBC Sport','NHL','NFL'].includes(reading?.source)||
    !String(reading.eventId||'').trim()||
    reading.gameId&&reading.gameId!==game?.id||
    !Number.isInteger(reading.home)||reading.home<0||
    !Number.isInteger(reading.away)||reading.away<0)return null;
 return {home:reading.home,away:reading.away};
}
// Period-specific trades require independently attributed scores, not an
// unverified Kalshi-only fallback when the two full-game scores disagree.
export function externalNoPeriods(game,reading,period=game?.period){
 const score=externalNoScore(game,reading);
 if(!score||!Number.isInteger(period)||period<1)return null;
 const supplied=reading.periods||reading.parts;
 if(!Array.isArray(supplied))return null;
 const parts=[];
 for(let n=1;n<=period;n++){
  const candidates=supplied.filter(p=>p?.number===n);
  if(candidates.length!==1)return null;
  const p=candidates[0];
  if(!Number.isInteger(p.home)||p.home<0||!Number.isInteger(p.away)||p.away<0)return null;
  parts.push({number:n,home:p.home,away:p.away});
 }
 if(supplied.some(p=>Number.isInteger(p?.number)&&p.number>period&&
    (p.home!==0||p.away!==0)))return null;
 const home=parts.reduce((n,p)=>n+p.home,0),away=parts.reduce((n,p)=>n+p.away,0);
 // The independently published period scores must reconcile to the same
 // independent full-game score, without borrowing provider/Kalshi points.
 if(home!==score.home||away!==score.away)return null;
 return parts;
}
