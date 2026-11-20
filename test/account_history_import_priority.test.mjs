import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('account history import gets a bounded turn before expensive legacy settlement and trade reconciliation',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function syncSettlementAlerts(){'),
   source.indexOf('async function milestones(){'));
 const start=section.indexOf('const claim=await pool.query(');
 const account=section.indexOf('await syncAccountHistory(');
 const legacy=section.indexOf('await syncTradeHistory(observedSettlements)');
 assert.ok(start>=0&&account>start&&legacy>start);
 assert.ok(account<legacy,'manual Kalshi account import must not starve behind slow bot-only reconciliation');
});
