import {overSignal,overCushionUnits,playerOverSpec} from './strategy.mjs';
import {overContractKey,timedOverEntryValid,assertTimedOverEntry,OVER_FRESH_MS} from './over_verification.mjs';
export const EXTERNAL_OVER_MAX_FRACTION=.60;
// Preserve a larger existing one-play allowance while requiring at least
// two/three removable units of the exact selected statistic.
export function externalOverMinimum(game,market,removals=3){
  const signal=overSignal(game,market),ordinary=overCushionUnits(game,market);
  if(!signal||playerOverSpec(game,market)||!Number.isInteger(ordinary)||ordinary<1)return null;
  if(![2,3].includes(removals))return null;
  const units=Math.max(removals,ordinary),minimum=Math.floor(signal.strike+units)+1;
  return signal.scored>=minimum?minimum:null;
}
export function externalOverExposureValid(game,market,now=Date.now()){
  const proof=game?.externalOverProof,removals=proof?.fraction===.60?3:proof?.fraction===.50?2:null;
  const minimum=externalOverMinimum(game,market,removals);
  return Boolean(proof&&removals!==null&&minimum!==null&&timedOverEntryValid(game,market,now)&&
    proof.contractKey===overContractKey(game,market)&&proof.minimumOverValue===minimum&&
    proof.verificationId===game.verificationId&&game.independentEntry.overValue>=minimum&&
    proof.requestedAt===game.independentEntry.requestedAt&&Number.isFinite(proof.requestedAt)&&
    now>=proof.requestedAt&&now-proof.requestedAt<=OVER_FRESH_MS);
}
export async function verifyExternalOverExposure(game,market,{now=Date.now}={}){
  delete game.externalOverProof;
  if(!timedOverEntryValid(game,market,now()))return false;
  const independent=game.independentEntry;
  if(!Number.isInteger(independent?.overValue))return false;
  for(const [removals,fraction] of [[3,.60],[2,.50]]){
    const minimumOverValue=externalOverMinimum(game,market,removals);
    if(minimumOverValue===null||independent.overValue<minimumOverValue)continue;
    game.externalOverProof={contractKey:overContractKey(game,market),minimumOverValue,fraction,
      requestedAt:independent.requestedAt,verificationId:game.verificationId};
    return externalOverExposureValid(game,market,now());
  }
  return false;
}
export function assertOverExposure(game,market,fraction,now=Date.now()){
  assertTimedOverEntry(game,market,now);
  if(fraction>.40&&(![.50,.60].includes(fraction)||!externalOverExposureValid(game,market,now)||fraction>game.externalOverProof.fraction))
    throw Object.assign(Error('Externally verified over cushion expired before dispatch'),{code:'LOCAL_OVER_PROOF_EXPIRED'});
}
