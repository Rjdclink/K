import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMiss,reviewExternalAmbiguity } from '../src/ai.mjs';

test('order recovery no longer spends an AI call',async()=>{
  assert.deepEqual(await reviewMiss(),{available:false,retry:true,
    reason:'Exchange history has no original order; bounded retry'});
});
test('Vireonix prepares only public facts and Claude reviews rare ambiguity',async()=>{
  const calls=[],facts={ticker:'KXTEST',issue:'Two public scores disagree'};
  const fetcher=async(url,options)=>{calls.push({url:String(url),options});
    return String(url).includes('vireonix')?{ok:true,json:async()=>({choices:[{message:{content:'The two scores differ.'}}]})}:
      {ok:true,json:async()=>({content:[{type:'text',text:'{"assessment":"conflict","reason":"Scores differ"}'}]})}};
  const options={env:{ANTHROPIC_API_KEY:'test-key'},fetcher,now:()=>1000};
  const result=await reviewExternalAmbiguity('sports',facts,options);
  assert.deepEqual(result,{available:true,assessment:'conflict',reason:'Scores differ',workerUsed:true});
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.headers['x-api-key'],undefined);
  assert.equal(calls[1].options.headers['x-api-key'],'test-key');
  assert.equal(JSON.parse(calls[1].options.body).model,'claude-haiku-5-5');
  assert.deepEqual(await reviewExternalAmbiguity('sports',facts,options),result);
  assert.equal(calls.length,2);
  assert.equal((await reviewExternalAmbiguity('mentions',{event:'other'},{env:{},fetcher})).available,false);
});
test('Claude can review public evidence when the Vireonix helper is unavailable',async()=>{
  const calls=[];
  const result=await reviewExternalAmbiguity('mentions',{event:'KXOTHER',issue:'Two official pages'},
    {env:{ANTHROPIC_API_KEY:'test-key'},fetcher:async(url,options)=>{
      calls.push({url:String(url),options});
      if(String(url).includes('vireonix'))throw Error('helper offline');
      return {ok:true,json:async()=>({content:[{type:'text',text:'{"assessment":"inconclusive","reason":"Check full page"}'}]})};
    }});
  assert.equal(result.assessment,'inconclusive');
  assert.equal(result.workerUsed,false);
  assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls[1].options.body).messages[0].content.includes('helper offline'),false);
});
