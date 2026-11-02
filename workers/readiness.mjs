export function assessWorker({baseline,candidate}={}){
  const reasons=[];
  if(!baseline||!candidate)return {ready:false,reasons:['Comparable measurements are missing']};
  if(baseline.projectionPeriodHours!==candidate.projectionPeriodHours||!(baseline.projectionPeriodHours>0))reasons.push('Cost projections must cover the same period');
  for(const [name,value] of [['baseline',baseline],['candidate',candidate]]){
    if(!Number.isFinite(value.totalOperatingUsd)||value.totalOperatingUsd<0)reasons.push(`${name} total operating cost is missing`);
    if(!Number.isInteger(value.samples)||value.samples<7)reasons.push(`${name} needs at least seven measurements`);
    if(!Number.isFinite(value.exchangeP95Ms)||value.exchangeP95Ms<=0||!Number.isFinite(value.databaseP95Ms)||value.databaseP95Ms<=0)reasons.push(`${name} exchange/database timing is missing`);
    if(!Number.isFinite(value.criticalPathP95Ms)||value.criticalPathP95Ms<=0)reasons.push(`${name} complete read-only path timing is missing`);
    if(value.measured!==true)reasons.push(`${name} timings must be measured, not simulated`);
    const age=Date.now()-Date.parse(value.at||'');
    if(!Number.isFinite(age)||age<0||age>86400000)reasons.push(`${name} measurements must be from the last 24 hours`);
  }
  if(!(candidate.totalOperatingUsd<baseline.totalOperatingUsd))reasons.push('Projected total operating cost is not lower');
  if(!(candidate.exchangeP95Ms<baseline.exchangeP95Ms))reasons.push('Kalshi communication is not measurably faster');
  if(!(candidate.criticalPathP95Ms<baseline.criticalPathP95Ms))reasons.push('Complete read-only exchange/database path is not faster');
  return {ready:reasons.length===0,reasons,
    projectedSavingUsd:baseline.totalOperatingUsd-candidate.totalOperatingUsd,
    limitation:'Cost remains a projection until confirmed on actual provider bills; public-endpoint latency is not fill latency.'};
}
