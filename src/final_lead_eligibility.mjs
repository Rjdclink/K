// Every lead candidate explicitly labelled eligible for final verification
// must receive an independent verification attempt. Liquidity/cash/fees are
// separate order-entry decisions, never a reason to silently omit this step.
export const finalLeadKey=c=>String(c?.state?.id||'')+'\0'+String(c?.market?.ticker||'');
export async function runEligibleFinalLeadChecks(candidates,{eligible,verify,record=async()=>{},concurrency=6}){
  const results=new Map(),ready=candidates.filter(eligible);
  let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,ready.length)},async()=>{
    while(next<ready.length){
      const c=ready[next++],at=Date.now();let decision=null,reason;
      try{decision=await verify(c);
        reason=decision===true?'Final score verification passed; checking live ask and order safeguards':
          decision===null?'Final score verification attempted: independent source unavailable':
            'Final score verification attempted: independent score not confirmed';
      }catch(e){reason='Final score verification attempted: '+String(e.message||e).slice(0,125)}
      const result={at,ok:decision===true,attempted:true,reason};
      results.set(finalLeadKey(c),result);
      try{await record(c,result)}catch{} // Audit telemetry failure cannot fabricate a score proof.
    }
  }));
  return results;
}