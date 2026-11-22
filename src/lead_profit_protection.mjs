import { teamScorePosition } from './strategy.mjs';

// Apply only to an unambiguously identified team-winner contract. A tie or
// any deficit stays at risk; while still leading, a one-goal/one-point margin
// means the next single score can eliminate the lead.
export function threatenedLead(game,market){
  if(!game||!market||!/(soccer|hockey|football|basketball)/.test(String(game.type||''))||
    game.feedId!==game.id||game.verifiedLive!==true||game.scoreKnown!==true||
    game.scoreConsistent!==true||game.periodConsistent!==true||
    !Number.isFinite(game.home)||!Number.isFinite(game.away))return false;
  const side=teamScorePosition(game,market);
  return side!==null&&(side<=0||Math.abs(game.home-game.away)<=1);
}