// The displayed amount is for the shares that can actually sell at the
// current bid. Exposure and paid fees come from the exchange's open position.
export function estimatedSaleProfitCents(position, sale, fallbackPrice) {
  const held=Number(position?.position_fp ?? position?.position);
  const count=Number(sale?.count),price=Number(sale?.price);
  if(!Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<=0||count>held||
    !Number.isFinite(price)||price<=0||price>=1)return null;
  const fraction=count/held;
  const exposure=Number(position?.market_exposure_dollars);
  const paidFees=Number(position?.fees_paid_dollars);
  const fallback=Number(fallbackPrice);
  if((!Number.isFinite(exposure)||exposure<0)&&(!Number.isFinite(fallback)||fallback<=0))return null;
  const basis=Number.isFinite(exposure)&&exposure>=0?exposure*100*fraction:count*fallback*100;
  const fees=Number.isFinite(paidFees)&&paidFees>=0?paidFees*100*fraction:0;
  // Reserve twice the standard taker fee; the exchange may charge less.
  const saleFees=Math.ceil(14*count*price*(1-price)-1e-8);
  return Math.floor(count*price*100-basis-fees-saleFees+1e-8);
}

// Require net proceeds for the executable quantity to reach 1.5 times its
// proportional acquisition cost, including paid entry and estimated sale fees.
export function oneAndHalfExitEligible(position,sale){
  const held=Number(position?.position_fp??position?.position),count=Number(sale?.count),price=Number(sale?.price);
  const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(position?.market_exposure_dollars==null||position?.fees_paid_dollars==null||
    !Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<=0||count>held||
    !Number.isFinite(price)||price<=0||price>=1||
    !Number.isFinite(exposure)||exposure<=0||!Number.isFinite(fees)||fees<0)return false;
  const acquisitionCents=(exposure+fees)*100*count/held;
  const saleFeeCents=Math.ceil(14*count*price*(1-price)-1e-8);
  const proceedsCents=Math.floor(100*count*price-saleFeeCents+1e-8);
  return proceedsCents>=Math.ceil(1.5*acquisitionCents-1e-8);
}

// Positive-profit exits apply to fast-moving single match winners; the
// separate 1.5x target can also apply to other holdings.
export function positiveExitEligible(trade, gameType, profitCents) {
  if (trade?.strategy !== 'lead' || !Number.isFinite(profitCents) || profitCents <= 0) return false;
  if (Array.isArray(trade.combo_legs) && trade.combo_legs.length >= 2) return false;
  const fast = (sport, type = '') => /basketball|^tennis(?:_|$)|^cricket_match$/i.test(String(type)) ||
    /^(?:NBA|WNBA|NCAAB|NCAAW|Basketball|eBasketball|Tennis)$/i.test(String(sport)) ||
    /\b(?:ODI|T20|Test International|Cricket)\b/i.test(String(sport));
  return fast(trade.sport, gameType);
}

