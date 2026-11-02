import {AsyncLocalStorage} from 'node:async_hooks';

// A real remote process owns a scan window; a queue entry is not a remote VM.
// The same session lock fences Neon cron, remote replicas and handoffs.
export const SCANNER_RUNTIME_LOCK=83027548;
const context=new AsyncLocalStorage();
export const SCANNER_RUNTIME_SCHEMA=`CREATE TABLE IF NOT EXISTS scanner_runtime_control (
  id integer PRIMARY KEY CHECK(id=1), owner text NOT NULL CHECK(owner IN ('neon','worker')),
  worker_id text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(owner='neon' OR (worker_id IS NOT NULL AND length(worker_id)>0)));
INSERT INTO scanner_runtime_control(id,owner) VALUES(1,'neon') ON CONFLICT DO NOTHING;`;

export async function scannerControl(client){
  try{
    const {rows:[row]}=await client.query('SELECT owner,worker_id FROM scanner_runtime_control WHERE id=1');
    if(!row)throw Error('Scanner ownership configuration is missing');
    return row;
  }catch(error){
    // An existing Neon installation continues normally before the optional
    // migration is installed. A worker never treats a missing table as consent.
    if(error.code==='42P01')return {owner:'neon',worker_id:null};
    throw error;
  }
}
const matches=(control,owner,id)=>control.owner===owner&&(owner==='neon'||control.worker_id===id);
function lost(){return Object.assign(Error('Scanner runtime no longer owns this work'),{code:'SCANNER_OWNERSHIP_LOST'})}

export async function assertScannerAuthority({write=false}={}){
  const active=context.getStore();
  if(!active)return; // User-requested dashboard operations retain their own gates.
  if(!active.valid||active.signal?.aborted)throw lost();
  // Confirm a live connection to the lock-holding session before any exchange
  // write. A disconnected old worker cannot keep using a cached ownership flag.
  if(write&&!matches(await scannerControl(active.client),active.owner,active.id))throw lost();
  if(!active.valid||active.signal?.aborted)throw lost();
}

export async function withScannerOwner(pool,{owner,id=null,signal},work){
  if(!['neon','worker'].includes(owner)||owner==='worker'&&!/^[A-Za-z0-9_.-]{1,120}$/.test(id||''))throw Error('Invalid scanner owner');
  const client=await pool.connect();let acquired=false,broken=false;
  const active={client,owner,id,signal,valid:true};
  const onError=()=>{active.valid=false;broken=true};
  client.on('error',onError);
  try{
    // A standby worker must not take the lock away from an assigned Neon tick.
    if(!matches(await scannerControl(client),owner,id))return {skipped:'scanner assigned to another runtime'};
    const {rows:[lock]}=await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[SCANNER_RUNTIME_LOCK]);
    acquired=Boolean(lock?.acquired);
    if(!acquired)return {skipped:'another scanner runtime owns the window'};
    if(!matches(await scannerControl(client),owner,id))return {skipped:'scanner assigned to another runtime'};
    if(signal?.aborted)return {skipped:'worker stopped'};
    return await context.run(active,work);
  }finally{
    active.valid=false;
    if(acquired&&!broken){
      try{await client.query('SELECT pg_advisory_unlock($1)',[SCANNER_RUNTIME_LOCK])}
      catch{broken=true}
    }
    client.removeListener('error',onError);
    client.release(broken);
  }
}
