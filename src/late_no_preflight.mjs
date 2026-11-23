// The nominal first-check clock begins eligibility; it is not an expiry.
// Paused game clocks do not delay a second proof: separation is measured only
// using real elapsed time from successful independent verification.
export const NO_PREFLIGHT_POLICY='late-elapsed-time-30-v4';
export const NO_PREFLIGHT_MIN_SECONDS=30;

export function tagNoPreflight(reading){
  if(!['ESPN','FOX Sports','Sofascore'].includes(reading?.source)||!reading.eventId)return null;
  return {...reading,preflight_policy:NO_PREFLIGHT_POLICY};
}

export function validNoPreflight(window,{gameId,contractKey,period,maxFirstSeconds,now=Date.now(),maxAgeMs=Infinity,allowZeroClock=false}={}){
  if(!window||window.game_id!==gameId||window.contract_key!==contractKey||
    Number(window.period)!==Number(period))return false;
  const first=Number(window.first_clock),firstAt=new Date(window.first_at).getTime(),
    proof=window.first_evidence,age=now-firstAt;
  return Number.isFinite(first)&&(first>0||allowZeroClock===true&&first===0)&&first<=maxFirstSeconds&&
    Number.isFinite(firstAt)&&age>=0&&age<=maxAgeMs&&
    proof?.preflight_policy===NO_PREFLIGHT_POLICY&&['ESPN','FOX Sports','Sofascore'].includes(proof.source)&&
    typeof proof.eventId==='string'&&proof.eventId.length>0;
}

export function lateNoPreflightProgress(window,now=Date.now()){
  const firstAt=new Date(window?.first_at).getTime(),elapsed=now-firstAt;
  if(!Number.isFinite(firstAt)||!Number.isFinite(elapsed)||elapsed<0){
    return {ready:false,waitSeconds:null,elapsedMs:null};
  }
  const waitSeconds=Math.max(0,(NO_PREFLIGHT_MIN_SECONDS*1000-elapsed)/1000);
  return {ready:waitSeconds===0,waitSeconds,elapsedMs:elapsed};
}
