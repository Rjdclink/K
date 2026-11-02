import {performance} from 'node:perf_hooks';

const ENDPOINT='https://external-api.kalshi.com/trade-api/v2/exchange/status';
export async function probeKalshi({samples=7,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>performance.now()}={}){
  if(!Number.isInteger(samples)||samples<3||samples>30)throw Error('Probe needs 3–30 samples');
  const times=[];
  for(let i=0;i<samples;i++){
    if(i)await wait(1250);
    const start=clock(),response=await fetcher(ENDPOINT,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error(`Kalshi probe returned ${response.status}`);
    const data=await response.json();
    if(typeof data.exchange_active!=='boolean'||typeof data.trading_active!=='boolean')throw Error('Unexpected Kalshi probe response');
    times.push(clock()-start);
  }
  const sorted=[...times].sort((a,b)=>a-b),at=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {kind:'public-exchange-round-trip',at:new Date().toISOString(),samples:times.length,
    medianMs:at(.5),p95Ms:at(.95),minMs:sorted[0],maxMs:sorted.at(-1),
    limitations:'Measures this host and public status endpoint only; not order-fill latency, database latency or billing savings.'};
}
