import {OVER_EXTERNAL_DELAY_MS} from './over_verification.mjs';

export function verificationStatus(record){
  const external=record.external_verified===true||record.external_verified==='true';
  if(record.passed&&!external)return 'Kalshi preflight passed; independent external verification still required';
  if(record.passed&&record.mode==='independent_timed_over')return 'Both external checks and paired Kalshi check passed; final quote pending';
  if(record.passed)return 'External score matched; fresh Kalshi read and final quote pending';
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
    (record.external_verified===true||record.external_verified==='true')&&
    Number.isFinite(updated)&&Number.isFinite(checked)&&checked>updated);
}
export function verificationWindowStatus(signal,window,timing,now=Date.now(),record=null){
  if(!signal?.verification_wait)return null;
  const execution=String(signal.execution||'').replace(/^Last market result: /,'');
  // A durable timer is not evidence that there is still a seller, cash, or an
  // eligible contract. Never overwrite the scanner's actual blocking gate.
  if(execution&&!/^(?:Awaiting score verification|Waiting for first external check|First external check passed; waiting for paired checks|(?:First|Second) external check due|Verification (?:due|window|recheck)|External score matched)/.test(execution))
    return {execution:signal.execution};
  if(signal.ask!==undefined&&!(Number(signal.ask)>0&&Number(signal.ask)<1&&Number(signal.ask_size)>0))
    return {execution:'No ask liquidity; verification paused until an executable seller returns'};
  const seen=Number(window?.last_seen);
  if(!window||!Number.isFinite(seen))
    return {execution:'Verification window expired; fresh checks required'};
  const checked=Date.parse(record?.created_at||'');
  if(record?.passed===false&&record.mode!=='seller_backed_cushioned_over_preflight'&&
    checked>=Number(window.initial_at)&&checked<=now)
    return {execution:verificationStatus(record),checkedAt:record.created_at};
  if(now-seen>90000)return {execution:`Verification recheck delayed; last checked ${Math.floor((now-seen)/1000)}s ago`};
  if(timing?.stage==='first_wait'||timing?.stage==='final_wait'){
    const seconds=Math.ceil(timing.remainingMs/1000);
    return {execution:timing.stage==='first_wait'?`Waiting for first external check (${seconds}s; minimum 20s)`:
      `First external check passed; waiting for paired checks (${seconds}s remaining)`,
      wait:{dueAt:Number(window.initial_at)+(timing.stage==='first_wait'?OVER_EXTERNAL_DELAY_MS:timing.minimumMs),updatedAt:seen}};
  }
  if(timing?.stage==='first_external')return {execution:'20s wait complete; first external check pending'};
  if(timing?.stage==='paired')return {execution:'Waiting period complete; paired external and Kalshi check pending'};
  return {execution:'Verification window recheck pending'};
}
