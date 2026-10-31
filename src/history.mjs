const numeric=value=>value===null||value===undefined||value===''?NaN:Number(value);
const yesFill=fill=>fill.outcome_side==='yes'||fill.side==='yes';
const time=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed:null};
export function manualSaleFill(sale){
  const r=sale?.result||{},count=numeric(r.fill_count),price=numeric(r.average_fill_price),fee=numeric(r.average_fee_paid);
  if(!sale?.ticker||!r.order_id||!Number.isFinite(count)||count<=0||!Number.isFinite(price)||price<=0||price>1||
    !Number.isFinite(fee)||fee<0||!time(sale.created_at))return null;
  return {ticker:sale.ticker,order_id:r.order_id,outcome_side:'yes',action:'sell',count_fp:String(count),
    yes_price_dollars:String(price),fee_cost:String(count*fee),created_time:time(sale.created_at).toISOString()};
}
export function reconcileManualSaleFills(fills,manualFills){
  const manualOrders=new Set(manualFills.map(fill=>fill.order_id));
  return fills.map(fill=>fill.action==='sell'&&manualOrders.has(fill.order_id)?
    {...fill,outcome_side:'yes',side:'yes'}:fill);
}

// Reconcile actual entry and exit fills. A partial sale appears only after its
// remaining contracts settle, so one history row reflects the whole trade.
export function completedTrade(entry,fills,settlement){
  if(!entry?.order_id||!entry?.market_ticker||!time(entry.created_at))return null;
  const relevant=fills.filter(fill=>(fill.ticker||fill.market_ticker)===entry.market_ticker&&yesFill(fill)&&
    time(fill.created_time)&&time(fill.created_time).getTime()>=time(entry.created_at).getTime()-1000);
  const valid=fill=>Number.isFinite(numeric(fill.count_fp))&&numeric(fill.count_fp)>0&&
    Number.isFinite(numeric(fill.yes_price_dollars))&&Number.isFinite(numeric(fill.fee_cost))&&numeric(fill.fee_cost)>=0;
  const buys=relevant.filter(fill=>fill.action==='buy');
  const permitted=new Set([entry.order_id,entry.upgrade_order_id,entry.robust_upgrade_order_id,entry.combo_upgrade_order_id].filter(Boolean));
  if(buys.some(fill=>!valid(fill)||!permitted.has(fill.order_id)))return null;
  const entryFills=buys;
  if(!entryFills.length)return null;
  const count=entryFills.reduce((sum,fill)=>sum+numeric(fill.count_fp),0);
  const expected=numeric(entry.fill_count)+(entry.upgrade_order_id?numeric(entry.upgrade_fill_count):0)+
    (entry.robust_upgrade_order_id?numeric(entry.robust_upgrade_fill_count):0)+
    (entry.combo_upgrade_order_id?numeric(entry.combo_upgrade_fill_count):0);
  if(!Number.isFinite(expected)||Math.abs(count-expected)>.011)return null;
  const sells=relevant.filter(fill=>fill.action==='sell');
  if(sells.some(fill=>!valid(fill)))return null;
  const sold=sells.reduce((sum,fill)=>sum+numeric(fill.count_fp),0);
  if(sold>count+.011)return null;
  if(Number.isFinite(numeric(entry.expected_sold))&&sold+0.011<numeric(entry.expected_sold))return null;
  const settled=settlement&&['yes','no'].includes(settlement.market_result)&&time(settlement.settled_time);
  if(!settled&&sold<count-.011)return null;
  const buyCost=entryFills.reduce((sum,fill)=>sum+numeric(fill.count_fp)*numeric(fill.yes_price_dollars)+numeric(fill.fee_cost),0);
  const saleRevenue=sells.reduce((sum,fill)=>sum+numeric(fill.count_fp)*numeric(fill.yes_price_dollars)-numeric(fill.fee_cost),0);
  const payout=settled&&settlement.market_result==='yes'?Math.max(0,count-sold):0;
  const occurredAt=settled?time(settlement.settled_time):sells.map(fill=>time(fill.created_time)).sort((a,b)=>b-a)[0];
  if(!occurredAt)return null;
  return {occurredAt:occurredAt.toISOString(),profitCents:Math.round((saleRevenue+payout-buyCost)*100),outcome:settled?'settled':'closed'};
}

