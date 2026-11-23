import {sportsContractKey} from './entry_verification.mjs';

// Two independent live fixture checks, separated by real elapsed time.
export const LEAD_EXTERNAL_WAIT_MS=60_000;
export const TWO_GOAL_EXTERNAL_WAIT_MS=120_000;
export const LEAD_FINAL_PROOF_MS=10_000;

// Only soccer/hockey commanding leads separated by precisely two goals
// require the longer interval. Check both independent readings: a first
// two-goal lead must not become a 60-second entry if the margin later grows.
const goalMargin=score=>{
 const home=score?.home,away=score?.away;
 return Number.isInteger(home)&&Number.isInteger(away)&&home>=0&&away>=0?
  Math.abs(home-away):null;
};
export function leadExternalWaitMs(game,firstEvidence=null){
 if(!/^(?:soccer|hockey)_/.test(String(game?.type||'')))return LEAD_EXTERNAL_WAIT_MS;
 const current=goalMargin(game?.externalScore)??
  goalMargin({home:game?.homeUnits,away:game?.awayUnits});
 return goalMargin(firstEvidence)===2||current===2?
  TWO_GOAL_EXTERNAL_WAIT_MS:LEAD_EXTERNAL_WAIT_MS;
}

export function leadFirstProofValid(window,game,market,now=Date.now()){
 const at=new Date(window?.first_at||'').getTime(),e=window?.first_evidence;
 return Boolean(window&&game&&market&&
  (!/^soccer_/.test(String(game.type||''))||
    Number.isInteger(game.externalScore?.home)&&Number.isInteger(game.externalScore?.away)&&
    e?.home===game.externalScore.home&&e?.away===game.externalScore.away)&&
  window.game_id===game.id&&window.contract_key===sportsContractKey(game,market)&&
  window.first_verification_id&&['ESPN','FOX Sports','BBC Sport','NHL','NFL'].includes(e?.source)&&
  e?.eventId&&e?.gameId===game.id&&
  Number.isInteger(e?.home)&&e.home>=0&&Number.isInteger(e?.away)&&e.away>=0&&
  Number.isFinite(at)&&at<=now);
}
export function leadFirstProofReady(window,game,market,now=Date.now()){
 return leadFirstProofValid(window,game,market,now)&&
  now-new Date(window.first_at).getTime()>=leadExternalWaitMs(game,window.first_evidence);
}

export function leadFinalProofValid(game,market,now=Date.now()){
 const proof=game?.leadVerification,entry=game?.independentEntry;
 return Boolean(game&&market&&proof&&entry&&
  proof.contractKey===sportsContractKey(game,market)&&
  proof.firstId&&proof.finalId&&proof.firstId!==proof.finalId&&
  proof.finalId===game.verificationId&&entry.verificationId===proof.finalId&&
  entry.contractKey===proof.contractKey&&
  Number.isFinite(proof.firstAt)&&Number.isFinite(proof.finalAt)&&
  proof.firstAt>=0&&proof.finalAt-proof.firstAt>=leadExternalWaitMs(game,proof.firstEvidence)&&
  now>=proof.finalAt&&now-proof.finalAt<=LEAD_FINAL_PROOF_MS&&
  Number.isFinite(entry.requestedAt)&&entry.requestedAt<=now&&
  now-entry.requestedAt<=LEAD_FINAL_PROOF_MS);
}
