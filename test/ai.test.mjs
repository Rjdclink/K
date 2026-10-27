import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMiss } from '../src/ai.mjs';

const input={signal:{strategy:'lead',reason:'7 to 2 touchdowns'},game:{id:'g'},market:{ticker:'T'},error:'timeout'};
test('Vireonix monitor uses A+ protocol and accepts only a structured bounded decision',async()=>{
  let sent;
  const result=await reviewMiss(input,{env:{AI_API_KEY:'test',AI_MODEL:'auto'},fetcher:async(url,options)=>{sent={url:String(url),options};return {ok:true,json:async()=>({choices:[{message:{content:'{"retry":true,"reason":"History has no order"}'}}]})}}});
  assert.equal(sent.url,'https://vireonix.ai/v1/chat/completions');
  assert.equal(sent.options.headers.authorization,'Bearer test');
  assert.deepEqual(result,{available:true,retry:true,reason:'History has no order'});
});
test('optional key follows the A+ protocol',async()=>{
  const result=await reviewMiss(input,{env:{},fetcher:async(url,options)=>{assert.equal(options.headers.authorization,undefined);return {ok:true,json:async()=>({choices:[{message:{content:'{"retry":false,"reason":"Hold"}'}}]})}}});
  assert.equal(result.available,true);assert.equal(result.retry,false);
});
