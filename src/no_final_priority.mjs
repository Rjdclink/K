import {validNoPreflight,lateNoPreflightProgress} from './late_no_preflight.mjs';

// Do not queue a second external check until the required independent first
// proof exists, the real-time separation has elapsed, and the EXACT contract
// is inside its entry window. A zero clock is permissible only when a caller
// independently verified soccer regulation stoppage.
export function eligibleNoFinal(window,game,{
 contractKey,firstSeconds,entrySeconds,remainingSeconds,allowZeroClock=false,
 validFirst=()=>true,now=Date.now()
}={}){
 const remaining=Number(remainingSeconds);
 if(!Number.isFinite(remaining)||!(remaining>0||allowZeroClock&&remaining===0)||
  !Number.isFinite(entrySeconds)||remaining>=entrySeconds)return false;
 return Boolean(validNoPreflight(window,{gameId:game?.id,contractKey,
  period:game?.period,maxFirstSeconds:firstSeconds,now,allowZeroClock})&&
  lateNoPreflightProgress(window,now).ready&&validFirst(window.first_evidence,game,now));
}

// All four sport families start their due finals together. The caller groups
// scanners sharing a bankroll cap, so entry/order sizing remains serialized
// within a sport while unrelated sports never block each other's ESPN checks.
export async function runImmediateNoFinalPass(groups,{onError=()=>{}}={}){
 // Wrap in microtasks: one synchronous scanner failure cannot prevent every
 // other sport from launching its independent final verification immediately.
 const results=await Promise.allSettled(groups.map(group=>
  Promise.resolve().then(()=>group.run())));
 results.forEach((result,i)=>{
  if(result.status==='rejected')onError(groups[i].sport,result.reason);
 });
 return results.reduce((sum,result)=>
  sum+(result.status==='fulfilled'?Number(result.value||0):0),0);
}

// One indexed lookup per sport replaces a per-contract database walk before
// ready final checks. Table names are fixed by the automated NO strategies.
const NO_WINDOW_TABLES=new Set(['college_total_no_windows','hockey_total_no_windows_v2',
 'nhl_early_period_no_windows','soccer_total_no_windows','soccer_first_half_no_windows',
 'basketball_early_quarter_no_windows']);
export async function dueNoFinalWindows(query,table,gameIds){
 if(!NO_WINDOW_TABLES.has(table))throw Error('Unsupported NO preflight table');
 if(!Array.isArray(gameIds)||gameIds.length===0)return new Map();
 const {rows}=await query('SELECT * FROM '+table+
  " WHERE game_id=ANY($1::text[]) AND first_at<=clock_timestamp()-interval '30 seconds'",
  [gameIds]);
 return new Map(rows.map(row=>[row.market_ticker,row]));
}

// Launch ESPN immediately for every ready *fixture*, not serially for every
// strike line of that fixture. Each contract still gets its OWN checked
// initial evidence, paired against a new final HTTP request, and a separate
// order/risk decision. Returned promises handle failure immediately so a
// rejected provider response cannot create an unhandled rejection.
export function launchImmediateNoFinalFixtures(candidates,{key,verify}){
 const started=new Map();
 for(const candidate of candidates){
  const fixture=String(key(candidate)||'');
  if(!fixture||started.has(fixture))continue;
  const task=Promise.resolve().then(()=>verify(candidate))
   .then(value=>({value,at:Date.now()}),error=>({error,at:Date.now()}));
  started.set(fixture,task);
 }
 return started;
}

const scoreSignature=game=>JSON.stringify([game?.id,game?.home,game?.away,
 game?.period,game?.periodScores||null]);

// A shared fixture proof is usable only for the same exact observed score
// and period, and only for a few seconds. Otherwise perform a new ESPN
// request at the ticket's own checkpoint; never extend a stale observation.
export async function immediateNoFinalProof(checks,fixtureKey,game,verifyFresh,{now}={}){
 const task=checks?.get(fixtureKey);
 if(!task)return verifyFresh();
 const result=await task;
 const first=result?.value,checked=Number.isFinite(now)?now:Date.now();
 if(result.error)throw result.error;
 if(first&&Number.isFinite(result.at)&&checked>=result.at&&checked-result.at<=8000&&
  scoreSignature(first.game)===scoreSignature(game))return first.proof;
 return verifyFresh();
}