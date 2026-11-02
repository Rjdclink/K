import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {SCANNER_RUNTIME_LOCK,SCANNER_RUNTIME_SCHEMA} from '../src/scanner_runtime.mjs';
import {assessWorker} from './readiness.mjs';

const [command,workerId,evidencePath]=process.argv.slice(2);
if(!['init','neon','worker'].includes(command))throw Error('Use: node workers/control.mjs init|neon|worker [worker-id] [evidence.json]');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const getHealth=async url=>{
  const endpoint=new URL('/health',url);
  if(endpoint.protocol!=='https:')throw Error('Health URL must use HTTPS');
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Health check failed');
  return response.json();
};
if(command!=='init'){
  if(!process.env.K_NEON_URL)throw Error('K_NEON_URL is required');
  const neon=await getHealth(process.env.K_NEON_URL);
  if(neon.scannerRuntimeProtocol!==1)throw Error('Deploy worker-aware Neon code before assigning scanner ownership');
}
if(command==='worker'){
  if(!/^[A-Za-z0-9_.-]{1,120}$/.test(workerId||'')||!evidencePath||!process.env.K_WORKER_URL)throw Error('Worker ID, measurement file and K_WORKER_URL are required');
  const evidence=JSON.parse(await readFile(evidencePath,'utf8')),decision=assessWorker(evidence);
  if(!decision.ready)throw Error('Worker is not ready: '+decision.reasons.join('; '));
  if(evidence.baseline.runtimeId!=='neon'||evidence.candidate.runtimeId!==workerId||
    evidence.baseline.scannerRuntimeProtocol!==1||evidence.candidate.scannerRuntimeProtocol!==1)throw Error('Measurement runtime IDs do not match the proposed handoff');
  const worker=await getHealth(process.env.K_WORKER_URL);
  if(worker.scannerRuntimeProtocol!==1||worker.role!=='active'||worker.workerId!==workerId||!worker.ok)throw Error('Assigned worker is not healthy and configured');
}
const client=new pg.Client({connectionString:process.env.DATABASE_URL,query_timeout:120000});
await client.connect();
try{
  if(command==='init')await client.query(SCANNER_RUNTIME_SCHEMA);
  else{
    await client.query('BEGIN');
    // Wait for every old scanner job and its queued combo work to finish.
    await client.query('SELECT pg_advisory_xact_lock($1)',[SCANNER_RUNTIME_LOCK]);
    const result=await client.query('UPDATE scanner_runtime_control SET owner=$1,worker_id=$2,updated_at=clock_timestamp() WHERE id=1 RETURNING owner,worker_id',
      [command,command==='worker'?workerId:null]);
    if(result.rowCount!==1)throw Error('Initialize scanner ownership first');
    await client.query('COMMIT');
  }
  console.log('Scanner ownership configuration saved.');
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
finally{await client.end()}
