import {performance} from 'node:perf_hooks';
import {EventEmitter} from 'node:events';

// Adapted from the user's Bad-Blue computationalBeam design at 8bae7c0:
// Antenna runs ordered light work inline, Beam owns bounded queued work,
// expired queued tasks are rejected, and telemetry describes actual execution. No fictional
// Cloudflare/Google nodes, random metrics or simulated remote capacity.
export class WorkerCompute extends EventEmitter{
  #queue=[];#running=false;#stopped=false;#sequence=0;
  #metrics={antenna:{calls:0,failures:0,elapsedMs:0},beam:{calls:0,failures:0,elapsedMs:0}};
  antenna(operation){
    if(this.#stopped)throw Error('Worker stopped');
    const start=performance.now(),metrics=this.#metrics.antenna;metrics.calls++;
    try{return operation()}catch(error){metrics.failures++;throw error}
    finally{metrics.elapsedMs+=performance.now()-start}
  }
  beam(operation,{priority=0,deadlineAt=Infinity,signal}={}){
    if(this.#stopped)return Promise.reject(Error('Worker stopped'));
    if(this.#queue.length>=4)return Promise.reject(Error('Worker queue full'));
    return new Promise((resolve,reject)=>{
      this.#queue.push({operation,priority,deadlineAt,signal,resolve,reject,sequence:this.#sequence++});
      void this.#drain();
    });
  }
  async #drain(){
    if(this.#running)return;
    this.#running=true;
    try{
      while(this.#queue.length){
        this.#queue.sort((a,b)=>a.deadlineAt-b.deadlineAt||b.priority-a.priority||a.sequence-b.sequence);
        const job=this.#queue.shift();
        if(this.#stopped||job.signal?.aborted||Date.now()>=job.deadlineAt){job.reject(Error('Worker task cancelled or expired'));continue}
        const start=performance.now(),metrics=this.#metrics.beam;metrics.calls++;
        this.emit('started');
        try{job.resolve(await job.operation())}catch(error){metrics.failures++;job.reject(error)}
        finally{metrics.elapsedMs+=performance.now()-start;this.emit('completed')}
      }
    }finally{this.#running=false}
  }
  stop(){this.#stopped=true;void this.#drain()}
  status(){return this.antenna(()=>({running:this.#running,queued:this.#queue.length,
    measured:structuredClone(this.#metrics),rssBytes:process.memoryUsage().rss}))}
}
