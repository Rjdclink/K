import { estimatedSaleProfitCents } from './positions.mjs';

export function eligibleProfitExit(strategy, position, sale, comboLegs=[]) {
  if(strategy!=='lead'||comboLegs.some(leg=>leg.strategy!=='lead'))return false;
  // Never auto-sell when the exchange has not supplied a verifiable fee-inclusive cost basis.
  if(!Number.isFinite(Number(position?.market_exposure_dollars))||position?.market_exposure_dollars==null||
     !Number.isFinite(Number(position?.fees_paid_dollars))||position?.fees_paid_dollars==null)return false;
  return (estimatedSaleProfitCents(position,sale)??0)>0;
}
