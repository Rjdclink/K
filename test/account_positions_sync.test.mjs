import test from 'node:test';
import assert from 'node:assert/strict';
import {syncAccountPositions} from '../src/account_positions_sync.mjs';

const settled={ticker:'KX-YES',realized_pnl_dollars:'2.39',fees_paid_dollars:'0.11',position_fp:'0.00'};
const archived={ticker:'KX-NETTED',realized_pnl_dollars:'-1.31',fees_paid_dollars:'0.14',position_fp:'0.00'};
function db(){
 const state={phase:'settled',cursor:'',completed_at:null};
 const positions=new Map();
 const query=async (sql,args=[])=>{
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('INSERT INTO account_positions_sync'))return {rows:[],rowCount:1};
  if(sql.startsWith('SELECT phase,cursor,completed_at'))return {rows:[{...state}]};
  if(sql.startsWith('INSERT INTO account_history_positions')){
   assert.match(sql,/\$1,\$2,\$3::jsonb/);positions.set(args[0],JSON.parse(args[2]));return {rows:[],rowCount:1};
  }
  if(sql.startsWith('UPDATE account_positions_sync SET phase=$1')){state.phase=args[0];state.cursor=args[1];return {rows:[],rowCount:1};}
  if(sql.includes("phase='complete'")){state.phase='complete';state.cursor='';state.completed_at=new Date().toISOString();return {rows:[],rowCount:1};}
  throw Error('Unexpected SQL '+sql);
 };
 return {state,positions,query};
}
test('position source imports only complete realized and fees fields from both paginated feeds',async()=>{
 const d=db(),calls=[];
 const fetchPage=async path=>{
  calls.push(path);
  if(path.startsWith('/portfolio/positions')&&!path.includes('cursor='))return {market_positions:[settled],cursor:'page2'};
  if(path.startsWith('/portfolio/positions'))return {market_positions:[],cursor:''};
  if(path.startsWith('/historical/positions'))return {market_positions:[archived],cursor:''};
  throw Error(path);
 };
 for(let i=0;i<4;i++)await syncAccountPositions({query:d.query,fetchPage,maxPages:1});
 assert.equal(d.state.phase,'complete');
 assert.equal(d.positions.size,2);
 assert.equal(d.positions.get('KX-NETTED').realized_pnl_dollars,'-1.31');
 assert.deepEqual(calls.map(p=>p.split('?')[0]),[
 '/portfolio/positions','/portfolio/positions','/historical/positions']);
 assert.match(calls[0],/settlement_status=settled/);
});
test('unavailable position endpoints and absent fee evidence fail closed',async()=>{
 const d=db();
 await assert.rejects(syncAccountPositions({query:d.query,fetchPage:async()=>({market_positions:[{ticker:'test',realized_pnl_dollars:'3'}],cursor:''})}),/Incomplete Kalshi market position/);
 assert.equal(d.state.phase,'settled');
 assert.equal(d.positions.size,0);
 await assert.rejects(syncAccountPositions({query:d.query,fetchPage:async()=>{throw Error('Not available')}}),/Not available/);
 assert.equal(d.state.phase,'settled');
});
