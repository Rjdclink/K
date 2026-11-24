// An exchange response can be uncertain, but a local pre-dispatch rejection
// cannot have placed an order. Keep the former blocked until order history is
// checked; retire the latter so it cannot block unrelated fixtures forever.
const LOCAL_CODES=new Set(['LOCAL_EXTERNAL_VERIFICATION_REQUIRED',
  'LOCAL_FINAL_FIVE_WINDOW_REQUIRED','LOCAL_GOAL_SCORE_LIMIT','LOCAL_ENTRY_EXCLUDED']);
const LOCAL_MESSAGE=/^New soccer\/hockey position blocked: combined game score (?:must remain below five goals|exceeds its entry limit)$/;

export function localNoPurchaseFailure(error){
 return LOCAL_CODES.has(error?.code)||LOCAL_MESSAGE.test(String(error?.message||''));
}

export async function reconcileUnresolvedNoOrders(query,lookup,resolve,{
 now=Date.now(),onError=()=>{}
}={}){
 const {rows}=await query(`SELECT id,market_ticker,status,order_id,fill_count,error,created_at
   FROM trade_attempts WHERE strategy='no' AND status IN ('reserved','check_order','retrying')
     AND (created_at<clock_timestamp()-interval '2 minutes' OR
       error LIKE 'New soccer/hockey position blocked:%')
   ORDER BY created_at LIMIT 25`);
 let cleared=0;
 for(const row of rows){
  const age=now-new Date(row.created_at).getTime();
  if(!row.order_id&&Number(row.fill_count)===0&&
    localNoPurchaseFailure({message:row.error})){
   const result=await query(`UPDATE trade_attempts SET status='unfilled',updated_at=clock_timestamp()
     WHERE id=$1 AND status=$2 AND order_id IS NULL AND fill_count=0 RETURNING id`,
     [row.id,row.status]);
   cleared+=result.rowCount||0;
   continue;
  }
  if(!Number.isFinite(age)||age<120000)continue;
  try{
   const order=await lookup(row.market_ticker,row.id,row.created_at);
   const outcome=resolve(order);
   if(outcome){
    const result=await query(`UPDATE trade_attempts SET status=$2,order_id=$3,
       fill_count=$4,updated_at=clock_timestamp() WHERE id=$1 AND status=$5 RETURNING id`,
      [row.id,outcome.filled>0?'filled':'unfilled',order.order_id||null,
       outcome.filled,row.status]);
    cleared+=result.rowCount||0;
   }else if(order===null&&age>=300000&&!row.order_id){
    const result=await query(`UPDATE trade_attempts SET status='unfilled',updated_at=clock_timestamp()
       WHERE id=$1 AND status=$2 AND order_id IS NULL AND fill_count=0 RETURNING id`,
      [row.id,row.status]);
    cleared+=result.rowCount||0;
   }
  }catch(error){onError(row,error)}
 }
 return cleared;
}
