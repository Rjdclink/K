import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('successful ESPN college fixture with insufficient cushion is not called unavailable',()=>{
 const section=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scanHockeyTotalNos('));
 assert.match(section,/Independent ESPN fixture verified; scoring cushion or exact contract not eligible/);
});
test('Kalshi crossed NFL stat does not claim ESPN failed before the dedicated proof checker runs',()=>{
 assert.doesNotMatch(source,/Variable player market identity or independent verification unavailable/);
 assert.match(source,/Variable player crossing awaiting independent ESPN proof/);
});
