import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewMiss} from '../src/ai.mjs';

test('order recovery uses exchange history without an AI request',async()=>{
  assert.deepEqual(await reviewMiss(),{available:false,retry:true,
    reason:'Exchange history has no original order; bounded retry'});
});

test('sports, mentions, and dashboard have no Claude request path',()=>{
  for(const file of ['index.mjs','mentions_source.mjs','ui.mjs','ai.mjs']){
    const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/api\.anthropic\.com|ANTHROPIC_API_KEY|reviewExternalAmbiguity|proposeMentionBinding|Claude review/);
  }
});
