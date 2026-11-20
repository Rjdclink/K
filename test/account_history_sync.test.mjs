import test from 'node:test';
import assert from 'node:assert/strict';
import {syncAccountHistory} from '../src/account_history_sync.mjs';
const at='2026-11-19T21:00:00Z',ended='2026-11-20T01:00:00Z';
function buy(fillId,ticker,side='yes',price='0.40',count='10'){
 return {fill_id:fillId,order_id:'order-'+fillId,ticker,action:'buy',side,
   count_fp:count,yes_price_dollars:side==='yes'?price:String(1-Number(price)),
   no_price_dollars:side==='no'?price:String(1-Number(price)),
   fee_cost:'0.10',created_time:at};
}
function storage(){
 const state={phase:'live_fills',cursor:'',last_completed:null},fills=new Map(),settlements=new Map(),history=new Map();
 const query=async(sql,args=[])=>{
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('INSERT INTO account_history_sync'))return {rows:[],rowCount:1};
  if(sql.startsWith('SELECT phase,cursor,last_completed'))return {rows:[{...state}]};
  if(sql.startsWith('UPDATE account_history_sync SET phase=')&&sql.includes('phase=$1')){
   state.phase=args[0];state.cursor=args[1];return {rows:[]};
  }
  if(sql.startsWith('UPDATE account_history_sync SET phase=')&&sql.includes("phase='complete'")){
   state.phase='complete';state.cursor='';state.last_completed=new Date().toISOString();return {rows:[]};
  }
  if(sql.startsWith('UPDATE account_history_sync SET phase=')&&sql.includes("phase='live_fills'")){
   state.phase='live_fills';state.cursor='';return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO account_history_fills')){
   assert.match(sql,/\$1/,'SQL parameters must be bound');
   for(let i=0;i<args.length;i+=4)fills.set(args[i],{fill_id:args[i],ticker:args[i+1],raw:JSON.parse(args[i+3])});
   return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO account_history_settlements')){
   for(let i=0;i<args.length;i+=4)settlements.set(args[i],{ticker:args[i+1],raw:JSON.parse(args[i+3])});
   return {rows:[]};
  }
  if(sql.startsWith('SELECT raw FROM account_history_fills'))return {rows:[...fills.values()]};
  if(sql.startsWith('SELECT raw FROM account_history_settlements'))return {rows:[...settlements.values()]};
  if(sql.startsWith('INSERT INTO account_realized_history')){
   for(let i=0;i<args.length;i+=6)history.set(args[i],{occurredAt:args[i+1],profitCents:args[i+2],fillCount:args[i+4]});
   return {rows:[]};
  }
  throw Error('unexpected SQL '+sql);
 };
 return {state,fills,settlements,history,query};
}
test('account-wide pages include bot and direct Kalshi trades exactly once and publish only after a complete historical import',async()=>{
 const db=storage(),requests=[];
 const read=async path=>{
  requests.push(path);
  if(path.startsWith('/portfolio/fills')){
   if(!path.includes('cursor='))return {fills:[buy('bot','KXBOT-A'),buy('manual','KXPERSONAL-B','no','0.30')],cursor:'older'};
   return {fills:[buy('bot','KXBOT-A')],cursor:''};
  }
  if(path.startsWith('/historical/fills'))return {fills:[],cursor:''};
  if(path.startsWith('/portfolio/settlements'))return {settlements:[
    {ticker:'KXBOT-A',market_result:'yes',revenue:1000,settled_time:ended},
    {ticker:'KXPERSONAL-B',market_result:'no',revenue:1000,settled_time:ended}
  ],cursor:''};
  throw Error('unknown endpoint '+path);
 };
 let r;
 for(let i=0;i<5;i++){
  r=await syncAccountHistory({query:db.query,fetchPage:read,maxPages:1});
  if(i<4)assert.equal(db.history.size,0,'partial import must not publish misleading totals');
 }
 assert.equal(r.phase,'complete');
 assert.equal(db.fills.size,2,'overlapping pages never double-count the same fill');
 assert.equal(db.history.get('KXBOT-A').profitCents,590);
 assert.equal(db.history.get('KXPERSONAL-B').profitCents,690);
 assert.deepEqual(requests.map(x=>x.split('?')[0]),
  ['/portfolio/fills','/portfolio/fills','/historical/fills','/portfolio/settlements']);
});
test('missing cursor or failed historical API never marks coverage complete',async()=>{
 const db=storage();
 await assert.rejects(syncAccountHistory({query:db.query,
   fetchPage:async()=>({fills:[]})}),/incomplete pagination/);
 assert.notEqual(db.state.phase,'complete');
 await syncAccountHistory({query:db.query,fetchPage:async()=>({fills:[],cursor:''}),maxPages:1});
 await assert.rejects(syncAccountHistory({query:db.query,fetchPage:async()=>{
   throw Error('historical feed not reachable');
 }}),/historical feed not reachable/);
 assert.notEqual(db.state.phase,'complete');
 assert.equal(db.history.size,0);
});
