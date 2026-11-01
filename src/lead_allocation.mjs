import { KALSHI_ONLY_FRACTION,strongKalshiOnlyLead } from './strategy.mjs';

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

// Entry rules stay in sport-specific signal functions; this cannot create one.
export function finalLeadFraction(first,second,signal,externallyVerified,market){
  if(signal?.strategy!=='lead')return signal?.fraction;
  if(second?.sport==='NBA'&&/basketball/.test(second.type)){
    if(!externallyVerified)return KALSHI_ONLY_FRACTION;
    const margin=Math.abs(second.homeUnits-second.awayUnits),seconds=second.remainingSeconds;
    if(!Number.isFinite(margin)||!Number.isFinite(seconds))return KALSHI_ONLY_FRACTION;
    if(margin<20)return .10; // Retained +8 route in the final 90 seconds.
    return Math.min(.15,.05+(seconds<240||margin>=25?.05:0)+
      (seconds<120||margin>=30?.05:0));
  }
  return externallyVerified||market&&strongKalshiOnlyLead(first,second,market)?.20:KALSHI_ONLY_FRACTION;
}
