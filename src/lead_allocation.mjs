import { stableSoccerLeadFraction, fallbackLeadFraction, KALSHI_ONLY_FRACTION } from './strategy.mjs';

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

// Apply a possession/serve/turn bonus only when both score observations
// identify control. Unknown control never earns a bonus. Entry rules remain
// in the sport-specific signal functions; this function cannot create one.
export function finalLeadFraction(first,second,signal,externallyVerified,market){
  if(signal?.strategy!=='lead')return signal?.fraction;
  if(!externallyVerified){
    const robust=market?fallbackLeadFraction(first,second,market):null;
    if(robust!==null)return Math.min(.15,robust+(leaderHasControl(first)&&leaderHasControl(second)?.02:0));
  }
  let fraction=stableSoccerLeadFraction(first,second,signal);
  const alreadySized=second.sport==='CFB'||
    signal.allocationPolicy==='early_football'||
    /soccer/.test(second.type)&&Math.abs(second.home-second.away)===1;
  if(!alreadySized&&leaderHasControl(first)&&leaderHasControl(second)){
    // Preserve existing higher soccer ceilings; newly boosted tiers stop at 35%.
    fraction=Math.min(Math.max(.35,signal.fraction),Math.round(fraction*100+5)/100);
  }
  return externallyVerified?fraction:Math.min(fraction,KALSHI_ONLY_FRACTION);
}
