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
