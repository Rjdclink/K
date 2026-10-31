import { AsyncLocalStorage } from 'node:async_hooks';

// Start a fresh held-position check on confirmed fills, but keep it outside
// the single-order/live-score path. Await jobs before a serverless response
// completes so the runtime cannot discard an unobserved background promise.
export function createFillComboQueue(check,{onError=()=>{}}={}){
  const context=new AsyncLocalStorage(),pending=new Map();
  let tail=Promise.resolve(),generation=0;
  function enqueue(fill=null,verifiedSince=null){
    const scope=context.getStore(),key=fill?.id;
    if(key&&pending.has(key)){
      const job=pending.get(key);scope?.jobs.add(job);return job;
    }
    if(key)generation++;
    const current=generation;
    const since=verifiedSince||scope?.startedAt||new Date();
    const job=tail.then(()=>{
      return check(fill,{verifiedSince:since,superseded:()=>current!==generation});
    }).catch(error=>{
      try{onError(error,fill)}catch{}
      return {filled:false,pending:false,error:String(error.message||error)};
    });
    tail=job;
    if(key)pending.set(key,job);
    scope?.jobs.add(job);
    void job.then(()=>{if(key&&pending.get(key)===job)pending.delete(key)});
    return job;
  }
  async function run(work){
    const scope={startedAt:new Date(),jobs:new Set()};
    return context.run(scope,async()=>{
      try{return await work()}
      finally{
        // Jobs may enqueue more work while they finish. No rejected combo
        // check is allowed to turn a confirmed single fill into an error.
        while(scope.jobs.size){const jobs=[...scope.jobs];scope.jobs.clear();await Promise.all(jobs)}
      }
    });
  }
  return {enqueue,run};
}
