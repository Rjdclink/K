import { AsyncLocalStorage } from 'node:async_hooks';

const context=new AsyncLocalStorage();
export const withApiPriority=(priority,work)=>context.run(priority,work);
export const apiPriority=()=>context.getStore()||'normal';
const rank={interactive:0,live:1,normal:2,background:3};

// Reserve only the next available shared slot. A queued catalog request must
// not book a future slot ahead of a live score/quote that arrives afterward.
export function createPriorityGate(reserve,{wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const queue=[];let running=false;
  async function drain(){
    if(running)return;
    running=true;
    try{
      while(queue.length){
        queue.sort((a,b)=>rank[a.priority]-rank[b.priority]);
        const job=queue[0];
        try{
          const delay=await reserve(job.priority);
          if(delay>0){await wait(Math.min(delay,250));continue}
          queue.splice(queue.indexOf(job),1);job.resolve();
        }catch(error){queue.splice(queue.indexOf(job),1);job.reject(error)}
      }
    }finally{running=false}
  }
  return (priority='normal')=>new Promise((resolve,reject)=>{
    queue.push({priority:Object.hasOwn(rank,priority)?priority:'normal',resolve,reject});
    void drain();
  });
}
