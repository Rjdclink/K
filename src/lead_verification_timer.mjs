import {sportsContractKey} from './entry_verification.mjs';

// Two independent live fixture checks, separated by real elapsed time.
export const LEAD_EXTERNAL_WAIT_MS=60_000;
export const LEAD_FINAL_PROOF_MS=10_000;

export function leadFirstProofValid(window,game,market,now=Date.now()){
 const at=new Date(window?.first_at||'').getTime(),e=window?.first_evidence;
 return Boolean(window&&game&&market&&
  window.game_id===game.id&&window.contract_key===sportsContractKey(game,market)&&
  window.first_verification_id&&['ESPN','FOX Sports'].includes(e?.source)&&
  e?.eventId&&e?.gameId===game.id&&
  Number.isInteger(e?.home)&&e.home>=0&&Number.isInteger(e?.away)&&e.away>=0&&
  Number.isFinite(at)&&at<=now);
}
export function leadFirstProofReady(window,game,market,now=Date.now()){
 return leadFirstProofValid(window,game,market,now)&&
  now-new Date(window.first_at).getTime()>=LEAD_EXTERNAL_WAIT_MS;
}

export function leadFinalProofValid(game,market,now=Date.now()){
 const proof=game?.leadVerification,entry=game?.independentEntry;
 return Boolean(game&&market&&proof&&entry&&
  proof.contractKey===sportsContractKey(game,market)&&
  proof.firstId&&proof.finalId&&proof.firstId!==proof.finalId&&
  proof.finalId===game.verificationId&&entry.verificationId===proof.finalId&&
  entry.contractKey===proof.contractKey&&
  Number.isFinite(proof.firstAt)&&Number.isFinite(proof.finalAt)&&
  proof.firstAt>=0&&proof.finalAt-proof.firstAt>=LEAD_EXTERNAL_WAIT_MS&&
  now>=proof.finalAt&&now-proof.finalAt<=LEAD_FINAL_PROOF_MS&&
  Number.isFinite(entry.requestedAt)&&entry.requestedAt<=now&&
  now-entry.requestedAt<=LEAD_FINAL_PROOF_MS);
}
