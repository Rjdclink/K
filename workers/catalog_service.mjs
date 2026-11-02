import {createPriorityGate} from '../src/api_priority.mjs';
import {discoverCurrentMilestones} from '../src/discovery.mjs';
import {WorkerCompute} from '../src/worker_compute.mjs';

// A supplemental public-data helper. It has no database connection, private
// exchange credentials, trading engine, replacement scanner or order endpoint.
export function createCatalogService({fetcher=fetch,now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  let nextAt=0,cache=null,inFlight=null,timer=null,lastRequest=0,closed=false,requests=0,lastError=null;
  const compute=new WorkerCompute();
  const gate=createPriorityGate(async()=>{
    const delay=Math.max(0,nextAt-now());if(delay)return delay;
    nextAt=now()+250;return 0;
  },{wait});
  async function get(path){
    if(!path.startsWith('/milestones?')&&path!=='/exchange/status')throw Error('Unsupported public read');
    for(let attempt=0;attempt<4;attempt++){
      await gate('background');requests++;
      const response=await fetcher('https://external-api.kalshi.com/trade-api/v2'+path,
        {headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
      if(response.status===429){
        const seconds=Number(response.headers.get('retry-after'));
        nextAt=Math.max(nextAt,now()+Math.min(60000,Math.max(1000,Number.isFinite(seconds)?seconds*1000:1000)));
        continue;
      }
      if(!response.ok)throw Error('Public Kalshi read failed: '+response.status);
      const result=await response.json();
      if(path.startsWith('/milestones?')&&!Array.isArray(result.milestones))throw Error('Invalid milestone response');
      return result;
    }
    throw Error('Public Kalshi rate limit');
  }
  function schedule(){
    clearTimeout(timer);
    if(closed||now()-lastRequest>180000)return;
    timer=setTimeout(()=>{void refresh().catch(()=>{})},45000);timer.unref?.();
  }
  function refresh(){
    if(inFlight)return inFlight;
    const started=now();
    inFlight=compute.beam(async()=>{
      const milestones=await discoverCurrentMilestones(get,now());
      cache={protocol:1,kind:'supplemental-catalog',generatedAt:new Date(now()).toISOString(),
        categories:['Sports','Esports'],milestones,buildMs:now()-started};lastError=null;
      return cache;
    }).catch(error=>{lastError=String(error.message);throw error}).finally(()=>{inFlight=null;schedule()});
    return inFlight;
  }
  return {
    catalog(){lastRequest=now();return cache&&now()-Date.parse(cache.generatedAt)<60000?Promise.resolve(cache):refresh()},
    health(){return compute.antenna(()=>({ok:true,kind:'supplemental-read-helper',executionAuthority:false,
      databaseCredentials:false,catalogReady:Boolean(cache),catalogAgeMs:cache?now()-Date.parse(cache.generatedAt):null,
      requests,lastError,compute:compute.status()}))},
    close(){closed=true;clearTimeout(timer);compute.stop()}
  };
}
