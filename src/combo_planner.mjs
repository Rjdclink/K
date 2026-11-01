import {randomUUID} from 'node:crypto';
import {comboPlannerScope,nextComboBatch,comboExclusionKey,comboCollection,comboGroupRejection,COMBO_RFQ_PLANS} from './combos.mjs';

export const COMBO_PLAN_SCHEMA=`
CREATE TABLE IF NOT EXISTS combo_plan_cursors (
  scope_key text PRIMARY KEY,progress jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS combo_plan_jobs (
  group_key text PRIMARY KEY,queue_order bigserial NOT NULL,leg_tickers text[] NOT NULL,collection_ticker text NOT NULL,
  phase text NOT NULL DEFAULT 'planned',lease_id uuid,lease_until timestamptz,
  combo_ticker text,combo_event_ticker text,combo_market jsonb,rfq_id text,
  rfq_requested_at timestamptz,rfq_attempts integer NOT NULL DEFAULT 0 CHECK(rfq_attempts<=1),
  outcome text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE combo_plan_jobs ADD COLUMN IF NOT EXISTS queue_order bigserial;
CREATE INDEX IF NOT EXISTS combo_plan_jobs_queue_idx ON combo_plan_jobs(queue_order)
  WHERE phase IN ('planned','market_ready');`;

// A cursor can advance only after its generated jobs are durable. Leases are
// held across network work, but the planner's transaction/lock is always short.
export function createComboPlanner(pool,{uuid=randomUUID}={}){
  let schema;
  const ensure=()=>schema??=pool.query(COMBO_PLAN_SCHEMA).catch(e=>{schema=null;throw e});
  async function claim(collections,candidates,{requiredTicker=null,excluded=new Set(),limit=COMBO_RFQ_PLANS}={}){
    await ensure();const client=await pool.connect();
    const byTicker=new Map(candidates.map(c=>[c.market.ticker,c])),tickers=[...byTicker.keys()];
    const byCollection=new Map(collections.map(c=>[c.collection_ticker,c]));
    const scope=comboPlannerScope(collections,candidates,requiredTicker);
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(83027549)');
      // A crashed request at an uncertain external POST must never issue it
      // again. Fully prepared markets can resume without recreating the RFQ.
      await client.query(`UPDATE combo_plan_jobs SET phase='complete',outcome='interrupted_external_request',
        lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
        WHERE phase IN ('creating_market','creating_rfq','rfq_open') AND lease_until<clock_timestamp()`);
      await client.query(`UPDATE combo_plan_jobs j SET phase=CASE WHEN a.status='filled' THEN 'filled' ELSE 'complete' END,
        outcome=a.status,updated_at=clock_timestamp() FROM trade_attempts a
        WHERE j.phase='submitted' AND a.market_ticker=j.combo_ticker AND a.status IN ('filled','unfilled','rejected')`);
      const {rows:[saved]}=await client.query('SELECT progress FROM combo_plan_cursors WHERE scope_key=$1 FOR UPDATE',[scope]);
      // Import only evidence of a real prior attempt. A diagnostic saying no
      // compatible collection was found must not consume an untried group.
      const {rows:legacy}=await client.query(`SELECT DISTINCT leg_tickers FROM combo_diagnostics
        WHERE status IN ('no_executable_quote','market_creation_failed','rfq_creation_failed')
          AND jsonb_typeof(leg_tickers)='array' AND leg_tickers<@to_jsonb($1::text[])`,[tickers]);
      const {rows:legacyOrders}=await client.query(`SELECT market_ticker,status,combo_legs FROM trade_attempts a
        WHERE combo_legs IS NOT NULL AND jsonb_array_length(combo_legs)>=2 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(a.combo_legs) leg WHERE NOT (leg->>'market_ticker'=ANY($1::text[])))`,[tickers]);
      for(const old of [...legacy,...legacyOrders.map(o=>({...o,leg_tickers:o.combo_legs.map(l=>l.market_ticker)}))]){
        const legs=old.leg_tickers.map(t=>byTicker.get(t));if(legs.length<2||legs.some(l=>!l))continue;
        const key=comboExclusionKey(legs),collection=comboCollection(collections,legs);
        const phase=old.status==='filled'?'filled':['combo_pending','reserved','check_order','retrying'].includes(old.status)?'submitted':'complete';
        await client.query(`INSERT INTO combo_plan_jobs(group_key,leg_tickers,collection_ticker,phase,combo_ticker,outcome)
          VALUES($1,$2,$3,$4,$5,'legacy_attempt_imported') ON CONFLICT DO NOTHING`,
          [key,legs.map(l=>l.market.ticker),collection?.collection_ticker||'',phase,old.market_ticker||null]);
      }
      const {rows:knownRows}=await client.query(`SELECT group_key FROM combo_plan_jobs WHERE leg_tickers<@$1::text[]`,[tickers]);
      const known=new Set(knownRows.map(r=>r.group_key));
      const {rows:pending}=await client.query(`SELECT * FROM combo_plan_jobs WHERE phase IN ('planned','market_ready')
        AND (lease_until IS NULL OR lease_until<clock_timestamp()) AND leg_tickers<@$1::text[]
        AND ($2::text IS NULL OR $2=ANY(leg_tickers)) ORDER BY queue_order,group_key`,[tickers,requiredTicker]);
      const valid=job=>{
        const legs=job.leg_tickers.map(t=>byTicker.get(t));
        if(legs.some(l=>!l)||comboExclusionKey(legs)!==job.group_key)return null;
        const collection=comboCollection([byCollection.get(job.collection_ticker)].filter(Boolean),legs)||comboCollection(collections,legs);
        if(!collection||!comboCollection([collection],legs)||comboGroupRejection(legs)||excluded.has(job.group_key)||
          legs.some((a,i)=>excluded.has(comboExclusionKey([a]))||legs.slice(i+1).some(b=>excluded.has(comboExclusionKey([a,b])))))return null;
        return {legs,collection,groupKey:job.group_key,job};
      };
      const ready=[];
      for(const row of pending){
        const plan=valid(row);
        if(plan)ready.push(plan);
        else {
          const legs=row.leg_tickers.map(t=>byTicker.get(t));
          if(legs.some(l=>!l)||comboExclusionKey(legs)!==row.group_key||comboGroupRejection(legs)||excluded.has(row.group_key))
            await client.query(`UPDATE combo_plan_jobs SET phase='complete',outcome='contract_or_eligibility_changed',updated_at=clock_timestamp()
              WHERE group_key=$1`,[row.group_key]);
        }
      }
      const batch=nextComboBatch(collections,candidates,{cursor:saved?.progress||{},maxPlans:limit,
        maxExamined:2048,excluded,known,requiredTicker});
      for(const plan of batch.plans){
        const {rows:[job]}=await client.query(`INSERT INTO combo_plan_jobs(group_key,leg_tickers,collection_ticker)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,
          [plan.groupKey,plan.legs.map(l=>l.market.ticker),plan.collection.collection_ticker]);
        if(job)ready.push({...plan,job});
      }
      await client.query(`INSERT INTO combo_plan_cursors(scope_key,progress) VALUES($1,$2)
        ON CONFLICT(scope_key) DO UPDATE SET progress=EXCLUDED.progress,updated_at=clock_timestamp()`,[scope,JSON.stringify(batch.cursor)]);
      const claimed=[];
      ready.sort((a,b)=>BigInt(a.job.queue_order)<BigInt(b.job.queue_order)?-1:BigInt(a.job.queue_order)>BigInt(b.job.queue_order)?1:0);
      for(const plan of ready.slice(0,limit)){
        const lease=uuid();
        const {rows:[job]}=await client.query(`UPDATE combo_plan_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '3 minutes',updated_at=clock_timestamp()
          WHERE group_key=$1 AND phase IN ('planned','market_ready') AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING *`,[plan.groupKey,lease]);
        if(job)claimed.push({...plan,job,lease});
      }
      await client.query('COMMIT');
      return {groups:claimed,coverage:batch.coverage,exhausted:batch.exhausted,examined:batch.examined,scope};
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
    finally{client.release()}
  }
  async function transition(plan,from,phase,values={}){
    const {rows:[job]}=await pool.query(`UPDATE combo_plan_jobs SET phase=$4,
      combo_ticker=COALESCE($5,combo_ticker),combo_event_ticker=COALESCE($6,combo_event_ticker),
      combo_market=COALESCE($7::jsonb,combo_market),rfq_id=COALESCE($8,rfq_id),outcome=COALESCE($9,outcome),
      rfq_requested_at=CASE WHEN $4='creating_rfq' THEN clock_timestamp() ELSE rfq_requested_at END,
      rfq_attempts=rfq_attempts+CASE WHEN $4='creating_rfq' THEN 1 ELSE 0 END,updated_at=clock_timestamp()
      WHERE group_key=$1 AND lease_id=$2 AND phase=ANY($3::text[]) AND lease_until>clock_timestamp()
        AND ($4<>'creating_rfq' OR rfq_attempts=0) RETURNING *`,
      [plan.groupKey,plan.lease,Array.isArray(from)?from:[from],phase,values.ticker||null,values.eventTicker||null,
        values.market?JSON.stringify(values.market):null,values.rfq||null,values.outcome||null]);
    if(job)plan.job=job;return Boolean(job);
  }
  async function release(plan,{superseded=false}={}){
    // Only work stopped before RFQ creation is resumable. Once an RFQ was
    // attempted, that exact unordered group stays recorded and is never retried.
    await pool.query(`UPDATE combo_plan_jobs SET phase=CASE
        WHEN phase IN ('creating_market','creating_rfq','rfq_open') THEN 'complete' ELSE phase END,
      outcome=CASE WHEN phase='rfq_open' THEN $3 ELSE outcome END,
      queue_order=CASE WHEN phase IN ('planned','market_ready') THEN nextval(pg_get_serial_sequence('combo_plan_jobs','queue_order')) ELSE queue_order END,
      lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE group_key=$1 AND lease_id=$2`,[plan.groupKey,plan.lease,superseded?'superseded_after_rfq':'no_executable_quote']);
  }
  return {ensure,claim,transition,release};
}
