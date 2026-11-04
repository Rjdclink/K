import test from 'node:test';
import assert from 'node:assert/strict';
import {dueMentionSeries} from '../src/mentions_schedule.mjs';

test('today is polled; future events wait for their contract day and changed series refresh',()=>{
  const at=Date.parse('2026-11-04T18:00:00Z');
  const catalog=['TODAY','FUTURE','EMPTY','NEW'].map(ticker=>({ticker,last_updated_ts:'v1'}));
  const schedule={TODAY:{updatedAt:'v1',checkedAt:at,today:true,future:0},
    FUTURE:{updatedAt:'v1',checkedAt:at,today:false,future:1},
    EMPTY:{updatedAt:'v1',checkedAt:at,today:false,future:0}};
  assert.deepEqual(dueMentionSeries(catalog,schedule,at+60_000).map(s=>s.ticker),['TODAY','NEW']);
  assert.deepEqual(dueMentionSeries(catalog,schedule,at+15*60_000).map(s=>s.ticker),['TODAY','EMPTY','NEW']);
  assert.deepEqual(dueMentionSeries(catalog,schedule,Date.parse('2026-11-05T05:01:00Z'))
    .map(s=>s.ticker),['TODAY','FUTURE','EMPTY','NEW']);
  assert.deepEqual(dueMentionSeries([{...catalog[1],last_updated_ts:'v2'}],schedule,at+60_000)
    .map(s=>s.ticker),['FUTURE']);
});
