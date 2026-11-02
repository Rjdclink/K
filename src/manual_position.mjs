import {bestYesAsk} from './orderbook.mjs';
export function takerFeeSpec(market,event,series,now=Date.now()){
  if(Date.parse(market?.fee_waiver_expiration_time||'')>now)return {type:'quadratic',multiplier:0};
  const type=market?.fee_type_override??event?.fee_type_override??series?.fee_type;
  const raw=market?.fee_multiplier_override??event?.fee_multiplier_override??series?.fee_multiplier;
  const multiplier=raw==null?NaN:Number(raw);
  return ['quadratic','quadratic_with_maker_fees'].includes(type)&&Number.isFinite(multiplier)&&multiplier>=0?
    {type,multiplier}:null;
}
// Kalshi's published taker fee is M * .07 * C * P * (1-P).
// Quotes remain estimates because an order can match several separate fills.
export function tradeFeeCents(levels,spec){
  if(!spec)return null;
  return levels.reduce((total,{price,count})=>total+Math.ceil(700*spec.multiplier*count*price*(1-price)-1e-8)/100,0);
}
export function cashoutEstimate(position,quote,spec){
  if(!quote)return null;
  const fee=tradeFeeCents(quote.levels,spec),gross=quote.gross_cents;
  const net=fee===null?null:Math.floor(gross-fee+1e-8);
  const held=Number(position?.position_fp??position?.position),exposure=Number(position?.market_exposure_dollars),paid=Number(position?.fees_paid_dollars);
  const costKnown=position?.market_exposure_dollars!=null&&position?.fees_paid_dollars!=null&&
    Number.isFinite(exposure)&&exposure>=0&&Number.isFinite(paid)&&paid>=0&&held>0;
  return {gross_cents:Math.floor(gross+1e-8),estimated_fee_cents:fee,net_cents:net,
    profit_cents:net!==null&&costKnown?Math.floor(gross-fee-(exposure+paid)*100*quote.count/held+1e-8):null};
}
export function manualPositionQuote(market,book,position,account,amountCents,shardBudget,spec){
  if(!market||!['active','open'].includes(market.status))return {reason:'Market is closed'};
  if(!(Number(position?.position_fp??position?.position)>0))return {reason:'This contract is no longer held'};
  if(!spec)return {reason:'Current trading fees are unavailable; retry the quote'};
  const ask=bestYesAsk(book);
  if(!ask)return {reason:'No YES seller is available'};
  const cash=Number(account?.balance),local=Number(shardBudget);
  if(!Number.isFinite(cash)||!Number.isFinite(local)||local<0)return {reason:'Available cash is unavailable'};
  const budget=Math.floor(Math.min(cash,local,amountCents));
  if(!Number.isFinite(budget)||budget<1)return {reason:'No available cash in this market’s shard'};
  const step=market.fractional_trading_enabled===false?1:.01;
  // Reserve twice the published fee and a rounding cent within the chosen amount.
  const unit=100*ask.price+14*spec.multiplier*ask.price*(1-ask.price);
  let count=Math.floor(Math.min(ask.size,Math.max(0,budget-1)/unit)/step+1e-8)*step;
  count=Number(count.toFixed(2));
  const reserved=n=>Math.ceil(100*n*ask.price-1e-8)+Math.ceil(14*spec.multiplier*n*ask.price*(1-ask.price)-1e-8)+1;
  while(count>=step&&reserved(count)>budget)count=Number((count-step).toFixed(2));
  if(count<step)return {reason:'Amount or ask depth is too small after fees'};
  return {price:ask.price,count,max_cost_cents:reserved(count),
    estimated_fee_cents:tradeFeeCents([{price:ask.price,count}],spec)};
}
