import { stableSoccerLeadFraction, KALSHI_ONLY_FRACTION } from './strategy.mjs';

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

function lateRugbyFallbackFraction(first,second){
  if(!/rugby/.test(String(second?.type||''))||first?.period!==2||second.period!==2||
    !first.verifiedLive||!second.verifiedLive||!first.scoreConsistent||!second.scoreConsistent||
    !first.periodConsistent||!second.periodConsistent||
    first.homeUnits!==second.homeUnits||first.awayUnits!==second.awayUnits||
    !Number.isFinite(second.remainingSeconds)||second.remainingSeconds<=0||second.remainingSeconds>=90||
    Number.isFinite(first.remainingSeconds)&&second.remainingSeconds>first.remainingSeconds)return null;
  const margin=Math.abs(second.homeUnits-second.awayUnits);
  if(!Number.isFinite(margin)||margin<15)return null;
  let percent=margin>=28?18:margin>=22?15:12;
  if(second.remainingSeconds<60)percent++;
  if(second.remainingSeconds<30)percent++;
  if(leaderHasControl(first)&&leaderHasControl(second))percent+=2;
  return Math.min(20,percent)/100;
}

// Apply a possession/serve/turn bonus only when both score observations
// identify control. Unknown control never earns a bonus. Entry rules remain
// in the sport-specific signal functions; this function cannot create one.
export function finalLeadFraction(first,second,signal,externallyVerified){
  if(signal?.strategy!=='lead')return signal?.fraction;
  if(!externallyVerified){
    const rugby=lateRugbyFallbackFraction(first,second);
    if(rugby!==null)return rugby;
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
