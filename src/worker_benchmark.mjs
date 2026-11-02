import {performance} from 'node:perf_hooks';

const distribution=values=>{
  const ordered=[...values].sort((a,b)=>a-b);
  return {medianMs:ordered[Math.ceil(ordered.length*.5)-1],p95Ms:ordered[Math.ceil(ordered.length*.95)-1]};
};
// The same read-only exchange/database chain runs in Neon and on a candidate
// host. No signal, reservation, funding request, RFQ or order is created.
export async function benchmarkWorkerRuntime({get,query,samples=7,clock=()=>performance.now()}){
  if(!Number.isInteger(samples)||samples<7||samples>15)throw Error('Benchmark needs 7–15 samples');
  const exchange=[],database=[],path=[];
  for(let i=0;i<samples;i++){
    const begun=clock();
    for(const [endpoint,auth] of [['/exchange/status',false],['/portfolio/balance',true],['/portfolio/positions?settlement_status=unsettled&count_filter=position&limit=1',true]]){
      let start=clock();await query('SELECT 1');database.push(clock()-start);
      start=clock();await get(endpoint,{auth});exchange.push(clock()-start);
    }
    path.push(clock()-begun);
  }
  return {kind:'read-only-preflight-chain',measured:true,at:new Date().toISOString(),samples,
    exchangeP95Ms:distribution(exchange).p95Ms,databaseP95Ms:distribution(database).p95Ms,
    criticalPathP95Ms:distribution(path).p95Ms,medianPathMs:distribution(path).medianMs,
    limitation:'Includes existing API quota waits and database overhead; excludes order submission, fills and actual billing.'};
}
