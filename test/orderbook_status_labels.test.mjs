import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../src/ui.mjs',import.meta.url),'utf8');
test('quoted exchange asks are not falsely presented as failed or pending orderbook verification',()=>{
 assert.doesNotMatch(ui,/orderbook not yet verified/);
 assert.doesNotMatch(ui,/not verified executable/);
 assert.match(ui,/YES quoted ask/);
 assert.match(ui,/NO executable ask/);
});
