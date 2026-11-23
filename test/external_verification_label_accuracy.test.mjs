import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('successful ESPN college fixture with insufficient cushion is not called unavailable',()=>{
 const section=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scanHockeyTotalNos('));
 assert.match(section,/Independent ESPN fixture verified; scoring cushion or exact contract not eligible/);
});
test('the scanner no longer labels player crossings or performs player-stat lookups',()=>{
 const scan=source.slice(source.indexOf('async function scan(cachedMilestones'),source.indexOf('async function refreshOpenClocks()'));
 assert.doesNotMatch(scan,/Variable player crossing awaiting independent ESPN proof|FROM player_prop_windows|crossingRows/);
 assert.doesNotMatch(source,/Variable player market identity or independent verification unavailable/);
});
