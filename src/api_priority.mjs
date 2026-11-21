import { AsyncLocalStorage } from 'node:async_hooks';

const context=new AsyncLocalStorage();
export const withApiPriority=(priority,work)=>context.run(priority,work);
export const apiPriority=()=>context.getStore()||'normal';
// Initial preflight and due-final evidence must never sit behind unrelated
// discovery, dashboard reads or position upgrades. Protective exits share
// the top tier because skipping an emergency exit could increase losses.
const rank={risk_exit:0,preflight_final:0,preflight:1,interactive:2,live:3,normal:4,background:5};

// Reserve only the next available shared slot. A queued catalog request must
// not book a future slot ahead of a live score/quote that arrives afterward.
export function createPriorityGate(reserve,{wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const queue=[];let running=false,urgentStreak=0,sequence=0;
  async function drain(){
    if(running)return;
    running=true;
    try{
      while(queue.length){
        queue.sort((a,b)=>rank[a.priority]-rank[b.priority]);
        const preflightPending=queue.some(j=>rank[j.priority]<=rank.preflight);
        const deferred=urgentStreak>=4&&!preflightPending?
          queue.filter(j=>rank[j.priority]>=rank.normal).sort((a,b)=>a.sequence-b.sequence)[0]:null;
        const job=deferred||queue[0];
        try{
          const delay=await reserve(job.priority);
          if(delay>0){await wait(Math.min(delay,250));continue}
          queue.splice(queue.indexOf(job),1);
          urgentStreak=rank[job.priority]<rank.normal?urgentStreak+1:0;job.resolve();
        }catch(error){queue.splice(queue.indexOf(job),1);job.reject(error)}
      }
    }finally{running=false}
  }
  return (priority='normal')=>new Promise((resolve,reject)=>{
    queue.push({priority:Object.hasOwn(rank,priority)?priority:'normal',sequence:sequence++,resolve,reject});
    void drain();
  });
}