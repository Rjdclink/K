import { estimatedSaleProfitCents } from './positions.mjs';

export function eligibleProfitExit(strategy, position, sale, comboLegs=[],feeReserveMultiplier=2) {
  if(strategy!=='lead'||comboLegs.some(leg=>leg.strategy!=='lead'))return false;
  // Never auto-sell when the exchange has not supplied a verifiable fee-inclusive cost basis.
  if(!Number.isFinite(Number(position?.market_exposure_dollars))||position?.market_exposure_dollars==null||
     !Number.isFinite(Number(position?.fees_paid_dollars))||position?.fees_paid_dollars==null)return false;
  return (estimatedSaleProfitCents(position,sale,undefined,feeReserveMultiplier)??0)>0;
}
// Protect the largest immediately executable quantity whose *worst possible*
// fill price yields positive cents after the verified proportional cost basis,
// paid acquisition fees, and conservatively reserved selling fees. Higher
// resting YES bids execute before lower levels; fill-or-kill at this limit
// cannot produce a lower price or a fee-inclusive loss under the quote model.
export function firstProfitableLeadQuote(position,book,{whole=false,feeReserveMultiplier=2}={}){
 const held=Number(position?.position_fp??position?.position);
 if(!Number.isFinite(held)||held<=0||!Array.isArray(book?.yes_dollars))return null;
 const unit=whole?1:100;
 const levels=book.yes_dollars.map(([price,size])=>({price:Number(price),size:Number(size)}))
  .filter(x=>Number.isFinite(x.price)&&x.price>0&&x.price<1&&
    Number.isFinite(x.size)&&x.size>0).sort((a,b)=>b.price-a.price);
 let available=0,best=null;
 for(const level of levels){
  available+=level.size;
  const count=Math.floor(Math.min(held,available)*unit+1e-7)/unit;
  if(count<=0||best&&count<=best.count)continue;
  const quote={price:level.price,count};
  if(eligibleProfitExit('lead',position,quote,[],feeReserveMultiplier))best=quote;
 }
 return best;
}
