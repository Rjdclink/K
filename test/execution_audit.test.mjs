import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionAudit} from '../src/execution_audit.mjs';

test('background decision records include gate, outcome, sizing, score, possession and quote',async()=>{
  const calls=[];const record=createExecutionAudit(async(...args)=>{calls.push(args)});
  const decision={source:'fast_lead',market:{ticker:'M',yes_ask_dollars:'.97',yes_ask_size_fp:'60'},
    signal:{strategy:'lead',fraction:.05},game:{id:'G',sport:'CFB',home:31,away:19,period:4,remainingSeconds:134,possessionSide:'away',observedAt:100},
    stage:'score_pair_verification',startedAt:1000};
  await record(decision);await record({...decision,stage:'submission',outcome:'filled',startedAt:2000});
  assert.equal(calls.length,3,'schema initialized once');
  const values=calls[1][1];assert.deepEqual(values.slice(0,4),['fast_lead','M','lead','G']);
  assert.deepEqual(values.slice(5,8),['score_pair_verification','skipped',null]);
  assert.deepEqual(JSON.parse(values[8]),{sport:'CFB',home:31,away:19,period:4,seconds:134,possession:'away',scoreObservedAt:100,ask:'.97',size:'60',fraction:.05});
  assert.match(calls[2][0],/checked_at<=EXCLUDED.checked_at/,'older slow decisions cannot overwrite newer ones');
  assert.equal(calls[2][1][6],'filled');
});
test('audit initialization retries after a database error',async()=>{
  let calls=0;const record=createExecutionAudit(async()=>{if(!calls++)throw Error('transient failure')});
  const d={source:'scan',market:{ticker:'M'},signal:{strategy:'lead'},game:{id:'G'},stage:'entry'};
  await assert.rejects(record(d),/transient failure/);await record(d);assert.equal(calls,3);
});
