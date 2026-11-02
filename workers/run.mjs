import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {WorkerCompute} from '../src/worker_compute.mjs';
import {probeKalshi} from './probe.mjs';

// Probe is the default: merely deploying a container cannot enable trading.
const role=process.env.K_WORKER_ROLE||'probe';
if(!['probe','active'].includes(role))throw Error('K_WORKER_ROLE must be probe or active');
if(process.argv.includes('--benchmark')){
  const engine=await import('../src/index.mjs');
  try{console.log(JSON.stringify(await engine.measureWorkerRuntime()))}
  finally{await engine.closeWorkerRuntime()}
}else if(process.argv.includes('--probe')){
  console.log(JSON.stringify(await probeKalshi()));
}else{
  const compute=new WorkerCompute(),controller=new AbortController();
  let last=null,phase='starting',running=Promise.resolve(),engine;
  const id=process.env.K_WORKER_ID;
  if(role==='active'){
    if(!id||!process.env.DATABASE_URL)throw Error('Active worker requires K_WORKER_ID and DATABASE_URL');
    engine=await import('../src/index.mjs');
  }
  const server=http.createServer((req,res)=>{
    // No public scan, trade, credentials or dashboard endpoints on the worker.
    if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404);res.end();return}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ok:phase!=='error',role,workerId:id||null,scannerRuntimeProtocol:1,
      sourceRevision:process.env.K_SOURCE_REVISION||null,phase,last,compute:compute.status()}));
  });
  server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Worker listening:',JSON.stringify({role,port:server.address().port})));
  const stop=()=>{phase='stopping';controller.abort();compute.stop();server.close()};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  if(role==='probe'){
    try{last=await probeKalshi();phase='probe-complete'}catch(error){phase='error';last={error:String(error.message)}}
  }else{
    running=(async()=>{
      try{
        while(!controller.signal.aborted){
          phase='scanning';
          const begun=Date.now(),cpu=process.cpuUsage();
          try{
            const result=await compute.beam(()=>engine.runWorkerScanner({id,signal:controller.signal}),{signal:controller.signal,priority:100});
            const elapsed=process.cpuUsage(cpu);
            last={at:new Date().toISOString(),elapsedMs:Date.now()-begun,cpuMs:(elapsed.user+elapsed.system)/1000,
              skipped:result.skipped||null,cycles:result.cycles||0};
            phase=result.skipped?'standby':'waiting';
            console.log('Worker window:',JSON.stringify(last));
            const wait=result.skipped||!result.active?60000:0;
            if(wait)await delay(wait,undefined,{signal:controller.signal});
          }catch(error){
            if(controller.signal.aborted)break;
            phase='error';last={at:new Date().toISOString(),error:String(error.code||'worker-window-failed')};
            console.error('Worker window deferred:',last.error);
            await delay(10000,undefined,{signal:controller.signal});
          }
        }
      }finally{await engine.closeWorkerRuntime()}
    })();
    running.catch(error=>{if(!controller.signal.aborted){console.error('Worker stopped:',error.code||error.name);process.exitCode=1;stop()}});
  }
}
