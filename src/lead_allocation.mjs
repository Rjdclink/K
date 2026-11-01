import { KALSHI_ONLY_FRACTION } from './strategy.mjs';

export function leaderHasControl(game){
  if(game?.darts){
    const d=game.darts;
    return d.firstLegs>d.secondLegs?d.nextThrow===d.firstId:
      d.secondLegs>d.firstLegs?d.nextThrow===d.secondId:false;
  }
  const home=game?.volleyball?.current?.home??game?.cricket?.homeTotal??game?.homeUnits;
  const away=game?.volleyball?.current?.away??game?.cricket?.awayTotal??game?.awayUnits;
  return Number.isFinite(home)&&Number.isFinite(away)&&home!==away&&
    game.possessionSide===(home>away?'home':'away');
}

// A qualifying winner has one verification-based ceiling across sports.
// Entry rules stay in sport-specific signal functions; this cannot create one.
export function finalLeadFraction(first,second,signal,externallyVerified,market){
  if(signal?.strategy!=='lead')return signal?.fraction;
  return externallyVerified?.20:KALSHI_ONLY_FRACTION;
}
