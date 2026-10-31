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

// Compare a full executable cash-out, after estimated sale fees, with half
// the position's net profit if every YES share pays out at settlement.
export function halfPotentialProfitExitEligible(position,sale){
  const held=Number(position?.position_fp??position?.position),count=Number(sale?.count);
  const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(position?.market_exposure_dollars==null||position?.fees_paid_dollars==null||
    !Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<held-1e-7||count>held||
    !Number.isFinite(exposure)||exposure<0||!Number.isFinite(fees)||fees<0)return false;
  const maximumNetCents=Math.floor(held*100-(exposure+fees)*100+1e-8);
  const saleProfitCents=estimatedSaleProfitCents(position,sale);
  return maximumNetCents>0&&saleProfitCents!==null&&saleProfitCents>0&&
    saleProfitCents*2>=maximumNetCents;
}

// A soccer total can be corrected after entry. Only a reversal that puts the
// held YES contract back at or below its line calls for an urgent cash-out.
export function soccerOverCorrectionAffects(original,game){
  if(original?.strategy!=='over'||!/soccer/.test(String(game?.type||''))||
    !/TOTAL/i.test(String(original.market_ticker||''))||/TEAMTOTAL/i.test(String(original.market_ticker||''))||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent)return false;
  const entry=String(original.reason||'').match(/^(\d+(?:\.\d+)?) scored; line (\d+(?:\.\d+)?) already passed/);
  const total=Number(game.home)+Number(game.away);
  return Boolean(entry)&&Number.isFinite(total)&&total<Number(entry[1])&&total<=Number(entry[2]);
}

