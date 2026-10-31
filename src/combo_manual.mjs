import {bestYesAsk} from './orderbook.mjs';

export function manualComboQuote(market,book,position,account,kalshiOnly=false,budgetCents=Infinity){
  if(!market||!['active','open'].includes(market.status))return {reason:'Combo market is closed'};
  if(Number(position?.position_fp??position?.position)<=0)return {reason:'Combo position is no longer held'};
  const best=bestYesAsk(book);
  if(!best)return {reason:'No YES seller is available'};
  const price=best.price,bankroll=Number(account?.balance)+Number(account?.portfolio_value);
  const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(!Number.isFinite(bankroll)||!Number.isFinite(exposure)||!Number.isFinite(fees))return {reason:'Balance or position cost unavailable'};
  const cap=Math.floor(bankroll*(kalshiOnly?.15:.50))-Math.ceil((exposure+fees)*100);
  const available=Math.min(Number(account.balance),cap,budgetCents);
  if(available<=0)return {reason:'No available cash within this combo’s allocation limit'};
  const feeFactor=Math.max(2,2*Number(market.fee_multiplier_override||0))*7;
  const unit=100*price+feeFactor*price*(1-price);
  let count=Math.floor(Math.min(best.size,available/unit)*100+1e-7)/100;
  if(market.fractional_trading_enabled===false)count=Math.floor(count);
  while(count>0&&Math.ceil(100*count*price)+Math.ceil(feeFactor*count*price*(1-price))>available)
    count=Math.round((count-(market.fractional_trading_enabled===false?1:.01))*100)/100;
  if(count<(market.fractional_trading_enabled===false?1:.01))return {reason:'Ask is too small for the available cash'};
  return {price,count,max_cost_cents:Math.ceil(100*count*price)+Math.ceil(feeFactor*count*price*(1-price)),
    estimated_profit_cents:Math.floor(100*count)-Math.ceil(100*count*price)-Math.ceil(feeFactor*count*price*(1-price))};
}
