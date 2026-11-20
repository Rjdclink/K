import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPositionProfit,publishVerifiedPositions} from '../src/account_position_profit.mjs';

const sourceTime='2026-11-20T23:25:22.420Z';
const settledTime='2026-11-20T21:00:00Z';
const record=(ticker,pnl,fees,known)=>({
 ticker,position:{realized_pnl_dollars:String(pnl),fees_paid_dollars:String(fees)},
 settlement:{settled_time:settledTime,market_result:'yes'},known_cents:known
});
function db(records){
 const state={completed_at:sourceTime,published_at:null};
 const rows=new Map(),calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('CREATE TABLE'))return {rows:[]};
  if(sql.startsWith('SELECT s.completed_at'))return {rows:[{...state}]};
  if(sql.startsWith('SELECT p.ticker'))return {rows:records};
  if(sql.startsWith('INSERT INTO account_position_realized_history')){
   assert.match(sql,/\$1,\$2::timestamptz,\$3::bigint,\$4::timestamptz/);
   for(let i=0;i<args.length;i+=4)rows.set(args[i],{time:args[i+1],profit:Number(args[i+2])});
   return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO account_position_history_publish')){
   state.published_at=args[0];return {rows:[]};
  }
  throw Error('Unrecognized SQL '+sql);
 };
 return {state,rows,calls,query};
}
test('position realized PnL is GROSS and fees must be deducted exactly once',()=>{
 assert.equal(verifiedPositionProfit({realized_pnl_dollars:'5.3607',fees_paid_dollars:'0.2407'}),512);
 assert.equal(verifiedPositionProfit({realized_pnl_dollars:'-2.5000',fees_paid_dollars:'0.0300'}),-253);
 assert.equal(verifiedPositionProfit({realized_pnl_dollars:'1.00'}),null);
});
test('fully reconciles both YES/NO netting markets only after independent calibration and publishes all results once',async()=>{
 const d=db([record('known',5.36,.24,512),record('netted',-1.31,.14,null)]);
 const result=await publishVerifiedPositions({query:d.query,minCalibration:1});
 assert.equal(result.status,'published');
 assert.equal(result.comparisons,1);
 assert.equal(result.positions,2);
 assert.equal(d.rows.get('known').profit,512);
 assert.equal(d.rows.get('netted').profit,-145);
 assert.equal(d.state.published_at,sourceTime);
 assert.equal((await publishVerifiedPositions({query:d.query,minCalibration:1})).status,'unchanged');
});
test('missing calibration or a mismatched known settled trade keeps publication closed',async()=>{
 const low=db([record('unverified',1.2,.1,null)]);
 assert.equal((await publishVerifiedPositions({query:low.query,minCalibration:1})).status,'deferred');
 assert.equal(low.state.published_at,null);
 const bad=db([record('bad',5.36,.24,508)]);
 await assert.rejects(publishVerifiedPositions({query:bad.query,minCalibration:1}),/calibration conflicts/);
 assert.equal(bad.state.published_at,null);
 assert.equal(bad.rows.size,0);
});
test('invalid settlement evidence or duplicated market records cannot publish synthetic profit',async()=>{
 const invalid=db([record('a',1,.02,98),{...record('b',1,.02,null),settlement:{market_result:'unknown',settled_time:settledTime}}]);
 await assert.rejects(publishVerifiedPositions({query:invalid.query,minCalibration:1}),/Incomplete settled/);
 assert.equal(invalid.rows.size,0);
 const dupe=db([record('a',1,.02,98),record('a',1,.02,98)]);
 await assert.rejects(publishVerifiedPositions({query:dupe.query,minCalibration:1}),/duplicate settlement/);
 assert.equal(dupe.state.published_at,null);
});
