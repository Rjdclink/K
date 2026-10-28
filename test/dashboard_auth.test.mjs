import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.mjs';
import { authorized, sessionCookie, sessionValid } from '../src/dashboard_auth.mjs';

const base='https://example.test';
const secret='test-only-password';

test('session cookie authenticates dashboard and rejects tampering and expiration',()=>{
  const now=Date.now();
  const cookie=sessionCookie(secret,now);
  assert.match(cookie,/HttpOnly; SameSite=Lax; Secure/);
  assert.ok(sessionValid(cookie,secret,now));
  assert.equal(sessionValid(cookie,secret,now+7*24*60*60*1000+1000),false);
  assert.equal(sessionValid(cookie,'changed-password',now),false);
  const last=cookie.indexOf('; Path')-1;
  const tampered=cookie.slice(0,last)+(cookie[last]==='A'?'B':'A')+cookie.slice(last+1);
  assert.equal(sessionValid(tampered,secret,now),false);
  assert.equal(authorized(new Request(base,{headers:{cookie}}),secret),true);
  assert.equal(authorized(new Request(base,{headers:{cookie,authorization:'Basic '+Buffer.from('rjdc:wrong').toString('base64')}}),secret),true);
});

test('in-page login avoids repeated browser Basic Auth challenges',async()=>{
  const old=process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_PASSWORD=secret;
  try{
    const request=(path,options={})=>app.fetch(new Request(base+path,options));
    const anonymous=await request('/');
    assert.equal(anonymous.status,303);
    assert.equal(anonymous.headers.get('location'),'/login');
    assert.equal(anonymous.headers.get('www-authenticate'),null);
    const api=await request('/api/state');
    assert.equal(api.status,401);
    assert.equal(api.headers.get('www-authenticate'),null);
    assert.equal((await request('/api/history')).status,401);
    assert.equal((await request('/history')).status,303);
    const login=await request('/login');
    assert.equal(login.status,200);
    assert.match(await login.text(),/autocomplete="current-password"/);
    const post=(password,origin=base)=>request('/login',{method:'POST',headers:{...(origin?{origin}:{}),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'rjdc',password}).toString()});
    assert.equal((await post(secret,'https://other.test')).status,403);
    const incorrect=await post('wrong');
    assert.equal(incorrect.status,401);
    assert.equal(incorrect.headers.get('www-authenticate'),null);
    const signedIn=await post(secret);
    assert.equal(signedIn.status,303);
    assert.equal((await post(secret,null)).status,303);
    const cookie=signedIn.headers.get('set-cookie');
    assert.ok(cookie);
    assert.equal((await request('/',{headers:{cookie}})).status,200);
    const dashboard=await request('/',{headers:{cookie}});
    assert.match(await dashboard.text(),/href="\/history" aria-label="Trade history"/);
    const history=await request('/history',{headers:{cookie}});
    assert.equal(history.status,200);
    assert.match(await history.text(),/Completed trades since history began/);
    const basic='Basic '+Buffer.from('rjdc:'+secret).toString('base64');
    assert.equal((await request('/',{headers:{authorization:basic}})).status,200);
  }finally{
    if(old===undefined)delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD=old;
  }
});
