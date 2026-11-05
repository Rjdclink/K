import {OVER_EXTERNAL_DELAY_MS} from './over_verification.mjs';

export function verificationStatus(record){
  if(record.passed&&record.mode==='seller_backed_cushioned_over')return 'Cushioned over; live seller checked; final quote pending';
  if(record.passed&&record.mode==='independent_timed_over')return 'Both external checks and paired Kalshi check passed; final quote pending';
  if(record.passed)return record.mode==='kalshi_only_crossed_over'?
    'Two Kalshi score checks passed; final quote pending':'External score matched; fresh Kalshi read and final quote pending';
  if(record.verification_issue)return record.verification_issue;
  if(record.independent_unavailable===true||record.independent_unavailable==='true')
    return 'No matching external live score; entry blocked';
  if(record.independent_unavailable===false||record.independent_unavailable==='false')
    return 'External score or match state disagrees with Kalshi';
  return 'Score verification did not pass';
}
export function completedOverWait(signal,record){
  const updated=Number(signal?.verification_wait?.updatedAt),checked=Date.parse(record?.created_at||'');
  return Boolean(signal?.verification_wait&&record?.passed&&record.mode==='independent_timed_over'&&
    Number.isFinite(updated)&&Number.isFinite(checked)&&checked>updated);
}
export function verificationWindowStatus(signal,window,timing,now=Date.now(),record=null){
  if(!signal?.verification_wait)return null;
  const ask=Number(signal.ask),size=Number(signal.ask_size);
  if(!(ask>0&&ask<1&&size>0))return {execution:'No ask liquidity'};
  const seen=Number(window?.last_seen);
  if(!window||!Number.isFinite(seen))
    return {execution:'Verification window expired; fresh checks required'};
  const checked=Date.parse(record?.created_at||'');
  if(record&&!record.passed&&Number.isFinite(checked)&&checked>=Number(window.initial_at)&&now-checked<=30000)
    return {execution:verificationStatus(record)};
  if(now-seen>30000)return {execution:'Verification window stale; fresh score and seller required'};
  if(timing?.stage==='first_wait'||timing?.stage==='final_wait'){
    const seconds=Math.ceil(timing.remainingMs/1000);
    return {execution:timing.stage==='first_wait'?`Waiting for first external check (${seconds}s; minimum 20s)`:
      `First external check passed; waiting for paired checks (${seconds}s remaining)`,
      wait:{dueAt:Number(window.initial_at)+(timing.stage==='first_wait'?OVER_EXTERNAL_DELAY_MS:timing.minimumMs),updatedAt:seen}};
  }
  if(timing?.stage==='first_external')return {execution:'First external check due; awaiting fresh verification'};
  if(timing?.stage==='paired')return {execution:'Second external check due; awaiting fresh verification'};
  return {execution:'Verification window recheck pending'};
}
