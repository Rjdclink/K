import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.mjs';
import pg from 'pg';
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

test('dashboard includes alerts in its existing refresh while the alert endpoint remains available',async()=>{
  const originalQuery=pg.Pool.prototype.query;
  const previousPassword=process.env.DASHBOARD_PASSWORD;
  const previousKey=process.env.KALSHI_API_KEY;
  const previousKeyId=process.env.KALSHI_API_KEY_ID;
  const alert={id:8,ticker:'KXTEST',profit_cents:25,settled_time:'2026-10-28T13:00:00Z'};
  const seen=[];
  process.env.DASHBOARD_PASSWORD=secret;
  process.env.KALSHI_API_KEY='';process.env.KALSHI_API_KEY_ID='';
  pg.Pool.prototype.query=async function(sql,params){
    seen.push({sql,params});
    if(sql.includes('SET clock_refresh_at='))return {rows:[]};
    if(sql.includes('CREATE TABLE IF NOT EXISTS combo_diagnostics'))return {rows:[]};
    if(sql.includes('FROM combo_diagnostics'))return {rows:[]};
    if(/FROM game_snapshots\s+WHERE/.test(sql))return {rows:[]};
    if(sql.includes('FROM scan_status WHERE'))return {rows:[{scanned:0,signals:0}]};
    if(sql.includes('FROM weather_scan_status WHERE'))return {rows:[{series:0,events:0,eligible:0,verified:0}]};
    if(sql.includes('FROM trade_attempts a LEFT JOIN'))return {rows:[]};
    if(sql.includes('FROM settlement_alerts WHERE'))return {rows:[alert]};
    throw Error('Unexpected query in dashboard test');
  };
  try{
    const headers={cookie:sessionCookie(secret,Date.now())};
    const response=await app.fetch(new Request(base+'/api/state?since=7',{headers}));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.deepEqual(body.alerts,[alert]);
    assert.deepEqual(body.games,[]);
    assert.equal(body.scan.scanned,0);
    assert.equal(body.orders.length,0);
    assert.equal(seen.filter(item=>item.sql.includes('FROM settlement_alerts WHERE')).length,1);
    assert.deepEqual(seen.find(item=>item.sql.includes('FROM settlement_alerts WHERE')).params,[7]);
    const legacy=await app.fetch(new Request(base+'/api/alerts?since=7',{headers}));
    assert.equal(legacy.status,200);
    assert.deepEqual((await legacy.json()).alerts,[alert]);
    assert.equal((await app.fetch(new Request(base+'/api/state?since=-1',{headers}))).status,400);
  }finally{
    pg.Pool.prototype.query=originalQuery;
    if(previousPassword===undefined)delete process.env.DASHBOARD_PASSWORD;else process.env.DASHBOARD_PASSWORD=previousPassword;
    if(previousKey===undefined)delete process.env.KALSHI_API_KEY;else process.env.KALSHI_API_KEY=previousKey;
    if(previousKeyId===undefined)delete process.env.KALSHI_API_KEY_ID;else process.env.KALSHI_API_KEY_ID=previousKeyId;
  }
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

test('history returns losses with signed totals and supports a loss-only view',async()=>{
  const originalQuery=pg.Pool.prototype.query,previousPassword=process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_PASSWORD=secret;
  const id='00000000-0000-4000-8000-000000000001',calls=[];
  pg.Pool.prototype.query=async function(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM trade_history')&&sql.includes('LIMIT 51'))return {rows:[{id,sport:'Soccer',teams:'Cottbus vs Bochum',occurred_at:'2026-10-30T19:00:00Z',profit_cents:-478}]};
    if(sql.includes('FROM trade_history')&&sql.includes('profit_count'))return {rows:[{profit_count:'49',loss_count:'2',profit_cents:'1245',loss_cents:'-1284'}]};
    throw Error('Unexpected history query');
  };
  try{
    const headers={cookie:sessionCookie(secret,Date.now())};
    const response=await app.fetch(new Request(base+'/api/history?filter=loss',{headers}));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.history[0].profit_cents,-478);
    assert.equal(body.summary.loss_cents,'-1284');
    assert.deepEqual(calls.find(call=>call.sql.includes('LIMIT 51')).params,[null,null,'loss']);
    assert.equal((await app.fetch(new Request(base+'/api/history?filter=unknown',{headers}))).status,400);
    const page=await app.fetch(new Request(base+'/history',{headers}));
    const html=await page.text();
    assert.match(html,/data-filter="loss"/);
    assert.match(html,/No realized losses since history began/);
  }finally{
    pg.Pool.prototype.query=originalQuery;
    if(previousPassword===undefined)delete process.env.DASHBOARD_PASSWORD;else process.env.DASHBOARD_PASSWORD=previousPassword;
  }
});

