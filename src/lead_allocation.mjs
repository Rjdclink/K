import { KALSHI_ONLY_FRACTION,strongKalshiOnlyLead,proBasketballLeadRules,leadSignal,playerOverSpec,PLAYER_PROP_MAX_FRACTION } from './strategy.mjs';
import { timedOverEntryValid } from './over_verification.mjs';
export function threeGoalWinner(game,signal,market){
  return Boolean(market&&signal?.strategy==='lead'&&/hockey|soccer/.test(game?.type||'')&&
    Math.abs(game.homeUnits-game.awayUnits)>=3&&leadSignal(game,market));
}
export const minimumThreeGoalSpend=(game,signal,market,bankroll)=>
  signal?.strategy==='lead'&&/hockey|soccer/.test(game?.type||'')&&Math.abs(game.homeUnits-game.awayUnits)>=3?
    threeGoalWinner(game,signal,market)?Math.ceil(bankroll*.15):Infinity:0;

export function verifiedOverFraction(signal,game,market){
  if(signal?.strategy!=='over')return signal?.fraction;
  if(!timedOverEntryValid(game,market))return Math.min(.15,signal.fraction);
  if(playerOverSpec(game,market))return PLAYER_PROP_MAX_FRACTION;
  if(game.overVerification?.route==='seller_cushion')return .40;
  return signal.fraction===.40?.40:.20;
}

export function lateCommandingLead(game,market){
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    !Number.isFinite(game.homeUnits)||!Number.isFinite(game.awayUnits))return false;
  const margin=Math.abs(game.homeUnits-game.awayUnits),seconds=game.remainingSeconds;
  if(/basketball/.test(game.type||''))return game.period===(game.sport==='NCAAB'?2:4)&&
    Number.isFinite(seconds)&&seconds>0&&seconds<105&&margin>=(game.sport==='NBA'?20:16);
  if(/hockey/.test(game.type||''))return game.period===3&&seconds>0&&seconds<120&&margin>=5;
  if(/football/.test(game.type||''))return game.period===4&&seconds>0&&seconds<90&&margin>=21;
  if(/soccer/.test(game.type||''))return game.period===2&&game.soccerMinute>85&&margin>=3;
  return false;
}
export function independentlyVerifiedLeadFraction(game,market){
  if(!lateCommandingLead(game,market))return .20;
  const margin=Math.abs(game.homeUnits-game.awayUnits),type=game.type||'';
  const top=/basketball/.test(type)?game.sport==='NBA'?30:25:/hockey/.test(type)?7:/football/.test(type)?28:/soccer/.test(type)?4:Infinity;
  return margin>=top?.30:.25;
}

export function directLeadFraction(game,signal,market){
  if(threeGoalWinner(game,signal,market))return .20;
  return signal?.strategy==='lead'&&lateCommandingLead(game,market)?.20:
    Math.min(.15,signal?.fraction??.15);
}
export function leadEntryFraction(first,second,signal,market,independent,direct){
  return independent===true?finalLeadFraction(first,second,signal,true,market):
    direct?directLeadFraction(second,signal,market):finalLeadFraction(first,second,signal,false,market);
}

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
  if(/^Restricted 5% draw\b/.test(signal.reason||''))return .05;
  if(/^Restricted 2% lead\b/.test(signal.reason||''))return .02;
  if(externallyVerified&&lateCommandingLead(second,market))return independentlyVerifiedLeadFraction(second,market);
  if(proBasketballLeadRules(second)){
    const margin=Math.abs(second.homeUnits-second.awayUnits),seconds=second.remainingSeconds;
    if(!Number.isFinite(margin)||!Number.isFinite(seconds))return KALSHI_ONLY_FRACTION;
    if(lateCommandingLead(second,market))return .20;
    if(margin<20)return .15; // The +9 and +12 NBA routes retain their lower allocation.
    return Math.min(.15,.05+(seconds<240||margin>=25?.05:0)+
      (seconds<120||margin>=30?.05:0));
  }
  if(threeGoalWinner(second,signal,market))return .20;
  return externallyVerified||market&&strongKalshiOnlyLead(first,second,market)?.20:KALSHI_ONLY_FRACTION;
}
