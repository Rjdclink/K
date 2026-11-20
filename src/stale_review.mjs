// A stale catalog milestone is never evidence of a live score or authority to trade.
// Recheck old fixtures against fresh Kalshi live data before retaining them in the
// active scan. Terminal pruning affects discovery only, never historical positions.
const EIGHT_HOURS=8*3600000;
const DAY=24*3600000;
const status=value=>String(value||'').toLowerCase().trim().replaceAll(' ','_');
const terminal=new Set(['final','finished','completed','closed','ended','event_closed','match_complete','canceled','cancelled']);
const live=new Set(['live','inprogress','in_progress','playing']);
const checkedAt=row=>Date.parse(row?.checked_at||'');
const eligibleAge=(m,now)=>{const start=Date.parse(m?.start_date||'');return Number.isFinite(start)&&now-start>EIGHT_HOURS;};
export const STALE_REVIEW_BATCH_SIZE=12;

// Results with unknown/unavailable external data are retried, not discarded.
// A confirmed-live old event is rechecked periodically and returns to the
// ordinary fresh score/period/market/independent-verification gates.
export function selectStaleReviews(milestones,reviews=[],now=Date.now(),limit=STALE_REVIEW_BATCH_SIZE){
 const byId=new Map(reviews.map(r=>[r.game_id,r]));
 const due=milestones.filter(m=>m?.id&&eligibleAge(m,now)).filter(m=>{
  const r=byId.get(m.id),at=checkedAt(r);
  if(!Number.isFinite(at))return true;
  const elapsed=now-at;
  return elapsed>=0&&elapsed>=(r.outcome==='terminal'?DAY:r.outcome==='live'?120000:300000);
 });
 due.sort((a,b)=>{
  const x=checkedAt(byId.get(a.id)),y=checkedAt(byId.get(b.id));
  const vx=Number.isFinite(x)?x:-Infinity,vy=Number.isFinite(y)?y:-Infinity;
  return vx-vy||String(a.id).localeCompare(String(b.id));
 });
 return due.slice(0,Math.max(0,Math.floor(limit)));
}
export function classifyStaleLive(milestone,reading,now=Date.now()){
 if(!reading||reading.milestone_id!==milestone?.id)return 'unknown';
 const details=reading.details||{},kind=status(details.status);
 if(terminal.has(kind))return 'terminal';
 if(!live.has(kind)||details.live_data_delayed===true)return 'unknown';
 const updated=Number(details.last_updated_ts)*1000;
 const scores=[details.home_score??details.home_points,details.away_score??details.away_points].map(Number);
 if(!Number.isFinite(Number(details.last_updated_ts))||details.last_updated_ts==null||
   !Number.isFinite(updated)||Math.abs(now-updated)>120000||
   scores.some(x=>!Number.isInteger(x)||x<0))return 'unknown';
 return 'live';
}
export function retainedAfterStaleReview(milestones,reviews=[],now=Date.now()){
 const terminalIds=new Set(reviews.filter(r=>r.outcome==='terminal'&&
   Number.isFinite(checkedAt(r))&&checkedAt(r)<=now&&now-checkedAt(r)<DAY)
   .map(r=>r.game_id));
 return milestones.filter(m=>!terminalIds.has(m.id)||!eligibleAge(m,now));
}
