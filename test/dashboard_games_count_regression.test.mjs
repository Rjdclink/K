import test from 'node:test';
import assert from 'node:assert/strict';
import {page} from '../src/ui.mjs';

test('games found counts all recent live fixtures even when independent score refresh is briefly delayed',()=>{
  const source=page.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
  assert.match(source,/\$\('gamesCount'\)\.textContent=x\.games\.length\+upcoming\.length;/,
    'a stale score flag must not make 44 discovered live games display as zero');
  assert.doesNotMatch(source,/\$\('gamesCount'\)\.textContent=x\.games\.filter\(g=>!g\.scoreStale\)\.length/);
});
