const numeric=value=>value===null||value===undefined||value===''?NaN:Number(value);
const yesFill=fill=>fill.outcome_side==='yes'||fill.side==='yes';
const time=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed:null};
// The broad settlement feed can omit a recently settled ticker. Retry final
// games directly after a short grace period, including losing settlements.
export function settlementLookupCandidates(pending,settled,now=Date.now(),offset=0,limit=5){
  const due=pending.filter(item=>!settled.has(item.market_ticker)&&
    Number.isFinite(new Date(item.created_at).getTime())&&
    now-new Date(item.created_at).getTime()>(item.game_status==='final'?5:47*60)*60000);
  if(!due.length)return [];
  const start=offset%due.length;
  return Array.from({length:Math.min(limit,due.length)},(_,i)=>due[(start+i)%due.length]);
}
export function manualSaleFill(sale){
  const r=sale?.result?.order||sale?.result||{};
  const count=numeric(r.fill_count_fp??r.fill_count);
  let price=numeric(r.average_fill_price),totalFee=numeric(r.average_fee_paid)*count;
  if(!Number.isFinite(price)){
    const maker=numeric(r.maker_fill_cost_dollars),taker=numeric(r.taker_fill_cost_dollars);
    // Canonical NO-side buys can represent our reduce-only YES sale. Actual
    // execution costs, not the limit price, establish its sale proceeds.
    if(Number.isFinite(maker)&&Number.isFinite(taker))
      price=r.outcome_side==='no'?(count-maker-taker)/count:(maker+taker)/count;
    totalFee=numeric(r.maker_fees_dollars)+numeric(r.taker_fees_dollars);
  }
  const occurred=time(r.created_time)||time(sale?.created_at);
  if(!sale?.ticker||!r.order_id||!Number.isFinite(count)||count<=0||!Number.isFinite(price)||price<0||price>1||
    !Number.isFinite(totalFee)||totalFee<0||!occurred)return null;
  return {ticker:sale.ticker,order_id:r.order_id,outcome_side:'yes',side:'yes',action:'sell',count_fp:String(count),
    yes_price_dollars:String(price),fee_cost:String(totalFee),created_time:occurred.toISOString()};
}
export function reconcileManualSaleFills(fills,manualFills,exitOrderIds=[]){
  const saleOrders=new Set([...manualFills.map(fill=>fill.order_id),...exitOrderIds].filter(Boolean));
  return fills.map(fill=>saleOrders.has(fill.order_id)?
    {...fill,action:'sell',outcome_side:'yes',side:'yes'}:fill);
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
  const manual=entry.manual_combo_buys||[];
  const permitted=new Set([entry.order_id,entry.upgrade_order_id,entry.robust_upgrade_order_id,entry.combo_upgrade_order_id,...manual.map(b=>b.order_id)].filter(Boolean));
  if(buys.some(fill=>!valid(fill)||!permitted.has(fill.order_id)))return null;
  const entryFills=buys;
  if(!entryFills.length)return null;
  const count=entryFills.reduce((sum,fill)=>sum+numeric(fill.count_fp),0);
  const expected=numeric(entry.fill_count)+(entry.upgrade_order_id?numeric(entry.upgrade_fill_count):0)+
    (entry.robust_upgrade_order_id?numeric(entry.robust_upgrade_fill_count):0)+
    (entry.combo_upgrade_order_id?numeric(entry.combo_upgrade_fill_count):0)+
    manual.reduce((sum,b)=>sum+numeric(b.fill_count),0);
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

