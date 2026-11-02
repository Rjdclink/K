import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementalCatalog} from '../src/catalog_helper.mjs';
import {createCatalogService} from '../workers/catalog_service.mjs';

const now=Date.now(),expiresAt=new Date(now+3600000).toISOString();
const data={protocol:1,kind:'supplemental-catalog',generatedAt:new Date(now).toISOString(),categories:['Sports','Esports'],
  milestones:[{id:'game',type:'basketball_game'}]};
const fetcher=async()=>Response.json(data);
test('supplement only accepts a fresh complete public catalogue while its host is unexpired',async()=>{
  assert.deepEqual(await supplementalCatalog('https://helper.invalid',{expiresAt,now,fetcher}),data);
  for(const change of [{protocol:2},{milestones:[]},{categories:['Sports']},{generatedAt:new Date(now-60001).toISOString()}])
    assert.equal(await supplementalCatalog('https://helper.invalid',{expiresAt,now,fetcher:async()=>Response.json({...data,...change})}),null);
  assert.equal(await supplementalCatalog('http://helper.invalid',{expiresAt,now,fetcher}),null);
  assert.equal(await supplementalCatalog('https://helper.invalid',{expiresAt:new Date(now-1).toISOString(),now,fetcher}),null);
  assert.equal(await supplementalCatalog('',{expiresAt,now,fetcher}),null);
  assert.equal(await supplementalCatalog('https://helper.invalid',{expiresAt,now,fetcher:async()=>{throw Error('unavailable')}}),null);
});
test('helper reads public data once per refresh, keeps both categories, and has no trading authority',async()=>{
  let clock=now;const paths=[];
  const service=createCatalogService({now:()=>clock,wait:async ms=>{clock+=ms},fetcher:async(url,opts)=>{
    paths.push(url);assert.equal(opts.method,undefined);assert.equal(opts.headers.authorization,undefined);
    const category=new URL(url).searchParams.get('category');
    return Response.json({milestones:[{id:category,type:'basketball_game',start_date:new Date(now-1000).toISOString()}]});
  }});
  try{
    const [a,b]=await Promise.all([service.catalog(),service.catalog()]);
    assert.equal(a,b);assert.equal(a.milestones.length,2);assert.equal(paths.length,2);
    await service.catalog();assert.equal(paths.length,2);
    assert.equal(service.health().executionAuthority,false);assert.equal(service.health().databaseCredentials,false);
    assert.ok(paths.every(path=>new URL(path).pathname==='/trade-api/v2/milestones'));
  }finally{service.close()}
});
