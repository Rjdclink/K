import { overSignal, overCushionUnits, playerOverSpec, variableValuePlayerMetric, periodValue } from './strategy.mjs';
import {sportsContractKey,independentEntryValid} from './entry_verification.mjs';
export function sameSportsContract(a,b){
  return Boolean(a&&b&&['ticker','event_ticker','rules_primary','floor_strike','cap_strike','close_time']
    .every(key=>a[key]===b[key])&&JSON.stringify(a.custom_strike||{})===JSON.stringify(b.custom_strike||{}));
}

export const OVER_EXTERNAL_DELAY_MS=20000;
export const OVER_CONFIRM_DELAY_MS=180000;
export const OVER_SOCCER_CONFIRM_DELAY_MS=150000;
export const OVER_VARIABLE_CONFIRM_DELAY_MS=240000;
export const OVER_FRESH_MS=10000;
export const OVER_MAX_GAP_MS=90000;
export const overContractKey=sportsContractKey;
export function freshOverObservation(game,now=Date.now()){
  return Boolean(game&&game.verifiedLive&&game.scoreKnown&&game.scoreConsistent&&game.feedId===game.id&&game.periodConsistent&&
    Number.isFinite(game.observedAt)&&game.observedAt<=now&&now-game.observedAt<=OVER_FRESH_MS&&
    (!Number.isFinite(game.updatedAt)||game.updatedAt<=game.observedAt+5000&&game.observedAt-game.updatedAt<=30000));
}
export function freshOverState(game,market,now=Date.now()){
  return freshOverObservation(game,now)&&Boolean(overSignal(game,market));
}
// Share the full-play cushion with candidate ranking and allocation. Variable
// player stats have no fixed safe play bound.
export function overCushion(game,market){
  const signal=overSignal(game,market),units=overCushionUnits(game,market);
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
  const delay=variableValuePlayerMetric(playerOverSpec(game,market)?.metric)?OVER_VARIABLE_CONFIRM_DELAY_MS:
    /soccer/.test(String(game?.type||''))?OVER_SOCCER_CONFIRM_DELAY_MS:OVER_CONFIRM_DELAY_MS;
  if(elapsed<delay&&cushion===null)return {stage:'final_wait',remainingMs:delay-elapsed,minimumMs:delay};
  return {stage:'paired',route:elapsed>=delay?'elapsed':'cushion',cushionUnits:cushion};
}
// Dashboard timing comes from the durable crossing, not a saved countdown.
// Expiry means a check is due; it never means verification has passed.
export function overWaitStatus(window,now=Date.now()){
  if(!window)return {execution:'Awaiting score verification'};
  if(now-Number(window.last_seen)>OVER_MAX_GAP_MS||Number(window.last_seen)>now)
    return {execution:'Awaiting score verification; live observation delayed'};
  const timing=overTiming(window,window.initial_state,window.contract,now);
  if(timing.stage==='invalid')return {execution:'Awaiting score verification; timer update unavailable'};
  const first=['first_wait','first_external'].includes(timing.stage);
  return {execution:first?'Waiting for first external check':'First external check passed; waiting for paired checks',
    verification_wait:{stage:first?'first':'paired',due_at:first?Number(window.initial_at)+OVER_EXTERNAL_DELAY_MS:now+(timing.remainingMs||0)}};
}
export function sameOverReading(first,second,market){
  const a=overSignal(first,market),b=overSignal(second,market);
  if(!a||!b||a.scored!==b.scored||a.strike!==b.strike)return false;
  const p=periodValue(first,market),q=periodValue(second,market);
  return Boolean(p)===Boolean(q)&&(!p||p.home===q.home&&p.away===q.away);
}
export function timedOverEntryValid(game,market,now=Date.now()){
  if(!independentEntryValid(game,market,now))return false;
  const proof=game?.overVerification;
  if(proof?.route==='seller_cushion')return Boolean(game.verificationId&&proof.contractKey===overContractKey(game,market)&&
    Number.isFinite(proof.sellerAt)&&now>=proof.sellerAt&&now-proof.sellerAt<=OVER_FRESH_MS&&
    freshOverState(game,market,now)&&overCushion(game,market)!==null);
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
