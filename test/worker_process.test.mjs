import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('a deployed worker defaults to read-only probes even when trading variables exist',async()=>{
  const preload='globalThis.fetch=async()=>({ok:true,json:async()=>({exchange_active:true,trading_active:true})});';
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'workers/run.mjs'],{
    cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe'],
    env:{PORT:'0',LIVE_TRADING:'true',DATABASE_URL:'postgresql://must-not-connect.invalid',KALSHI_API_KEY_ID:'unused',KALSHI_PRIVATE_KEY:'unused'}
  });
  let errorOutput='';child.stderr.on('data',chunk=>{errorOutput+=chunk});
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Worker startup timed out: '+errorOutput)),5000);
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Worker listening: (\{[^\n]+\})/);
        if(match){clearTimeout(timer);resolve(JSON.parse(match[1]).port)}});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Worker exited: '+code+' '+errorOutput))});
    });
    const base='http://127.0.0.1:'+port;
    const health=await (await fetch(base+'/health')).json();
    assert.equal(health.role,'probe');assert.equal(health.scannerRuntimeProtocol,1);
    assert.equal((await fetch(base+'/tick',{method:'POST'})).status,404);
    assert.equal((await fetch(base+'/api/sell',{method:'POST'})).status,404);
    assert.equal(JSON.stringify(health).includes('must-not-connect'),false);
  }finally{child.kill('SIGTERM');await once(child,'exit')}
});
