import { overSignal, playerOverSpec, fallbackScoringUnits, periodValue } from './strategy.mjs';

export const OVER_EXTERNAL_DELAY_MS=20000;
export const OVER_CONFIRM_DELAY_MS=210000;
export const OVER_FRESH_MS=10000;
export const OVER_MAX_GAP_MS=90000;
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
export function overContractKey(game,market){
  return JSON.stringify(sorted({game:game.id,ticker:market.ticker,event:market.event_ticker,
    rules:market.rules_primary,secondary:market.rules_secondary,strike:market.floor_strike,
    cap:market.cap_strike,strikeType:market.strike_type,close:market.close_time,custom:market.custom_strike||{}}));
}
export function freshOverObservation(game,now=Date.now()){
  return Boolean(game&&game.verifiedLive&&game.scoreKnown&&game.scoreConsistent&&game.feedId===game.id&&game.periodConsistent&&
    Number.isFinite(game.observedAt)&&game.observedAt<=now&&now-game.observedAt<=OVER_FRESH_MS&&
    (!Number.isFinite(game.updatedAt)||game.updatedAt<=game.observedAt+5000&&game.observedAt-game.updatedAt<=30000));
}
export function freshOverState(game,market,now=Date.now()){
  return freshOverObservation(game,now)&&Boolean(overSignal(game,market));
}
// Player statistics use one credited unit. Yardage has no fixed safe play
// bound. Team/game/period totals remove the sport's conservative full-play bound.
export function overCushion(game,market){
  const signal=overSignal(game,market),player=playerOverSpec(game,market);
  const units=player?['PASSYDS','RUSHYDS','RECYDS'].includes(player.metric)?null:1:fallbackScoringUnits(game);
  return signal&&Number.isInteger(units)&&signal.scored-units>signal.strike?units:null;
}
export function overTiming(window,game,market,now=Date.now()){
  const initial=Number(window.initial_at),external=window.first_external_at==null?null:Number(window.first_external_at);
  const elapsed=now-initial;
  if(!Number.isFinite(initial)||elapsed<0)return {stage:'invalid'};
  if(elapsed<OVER_EXTERNAL_DELAY_MS)return {stage:'first_wait',remainingMs:OVER_EXTERNAL_DELAY_MS-elapsed};
  if(external===null)return {stage:'first_external',remainingMs:0};
  if(!Number.isFinite(external)||external<initial+OVER_EXTERNAL_DELAY_MS||external>now||!window.first_external_id)return {stage:'invalid'};
  const cushion=overCushion(game,market);
  if(elapsed<OVER_CONFIRM_DELAY_MS&&cushion===null)
    return {stage:'final_wait',remainingMs:OVER_CONFIRM_DELAY_MS-elapsed};
  return {stage:'paired',route:elapsed>=OVER_CONFIRM_DELAY_MS?'elapsed':'cushion',cushionUnits:cushion};
}
export function sameOverReading(first,second,market){
  const a=overSignal(first,market),b=overSignal(second,market);
  if(!a||!b||a.scored!==b.scored||a.strike!==b.strike)return false;
  const p=periodValue(first,market),q=periodValue(second,market);
  return Boolean(p)===Boolean(q)&&(!p||p.home===q.home&&p.away===q.away);
}
export function timedOverEntryValid(game,market,now=Date.now()){
  const proof=game?.overVerification;
  if(!proof||!game.verificationId||proof.contractKey!==overContractKey(game,market)||
    !freshOverState(game,market,now)||!Number.isFinite(proof.pairedAt)||proof.pairedAt>now||
    now-proof.pairedAt>OVER_FRESH_MS||!proof.pairedExternalId||proof.pairedExternalId===proof.firstExternalId)return false;
  const timing=overTiming({initial_at:proof.initialAt,first_external_at:proof.firstExternalAt,
    first_external_id:proof.firstExternalId},game,market,proof.pairedAt);
  return timing.stage==='paired'&&(proof.route!=='cushion'||overCushion(game,market)!==null);
}

export function assertTimedOverEntry(game,market,now=Date.now()){
  if(!timedOverEntryValid(game,market,now))throw Object.assign(Error('Timed over verification expired before dispatch'),{code:'LOCAL_OVER_PROOF_EXPIRED'});
}
