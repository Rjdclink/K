const numeric=value=>value===null||value===undefined||value===''?NaN:Number(value);
const yesFill=fill=>fill.outcome_side==='yes'||fill.side==='yes';
const time=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed:null};

// Reconcile actual entry and exit fills. A partial sale appears only after its
// remaining contracts settle, so one history row reflects the whole trade.
export function completedTrade(entry,fills,settlement){
  if(!entry?.order_id||!entry?.market_ticker||!time(entry.created_at))return null;
  const relevant=fills.filter(fill=>(fill.ticker||fill.market_ticker)===entry.market_ticker&&yesFill(fill)&&
    time(fill.created_time)&&time(fill.created_time).getTime()>=time(entry.created_at).getTime()-1000);
  const valid=fill=>Number.isFinite(numeric(fill.count_fp))&&numeric(fill.count_fp)>0&&
    Number.isFinite(numeric(fill.yes_price_dollars))&&Number.isFinite(numeric(fill.fee_cost))&&numeric(fill.fee_cost)>=0;
  const buys=relevant.filter(fill=>fill.action==='buy');
  if(buys.some(fill=>!valid(fill)||fill.order_id!==entry.order_id))return null;
  const entryFills=buys;
  if(!entryFills.length)return null;
  const count=entryFills.reduce((sum,fill)=>sum+numeric(fill.count_fp),0);
  if(Math.abs(count-numeric(entry.fill_count))>.011)return null;
  const sells=relevant.filter(fill=>fill.action==='sell');
  if(sells.some(fill=>!valid(fill)))return null;
  const sold=sells.reduce((sum,fill)=>sum+numeric(fill.count_fp),0);
  if(sold>count+.011)return null;
  const settled=settlement&&['yes','no'].includes(settlement.market_result)&&time(settlement.settled_time);
  if(!settled&&sold<count-.011)return null;
  const buyCost=entryFills.reduce((sum,fill)=>sum+numeric(fill.count_fp)*numeric(fill.yes_price_dollars)+numeric(fill.fee_cost),0);
  const saleRevenue=sells.reduce((sum,fill)=>sum+numeric(fill.count_fp)*numeric(fill.yes_price_dollars)-numeric(fill.fee_cost),0);
  const payout=settled&&settlement.market_result==='yes'?Math.max(0,count-sold):0;
  const occurredAt=settled?time(settlement.settled_time):sells.map(fill=>time(fill.created_time)).sort((a,b)=>b-a)[0];
  if(!occurredAt)return null;
  return {occurredAt:occurredAt.toISOString(),profitCents:Math.round((saleRevenue+payout-buyCost)*100),outcome:settled?'settled':'closed'};
}
