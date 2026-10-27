export function favorableSettlement(s){
  if(s?.market_result!=='yes'||!Number.isFinite(Number(s.yes_count_fp))||Number(s.yes_count_fp)<=0)return null;
  if(s.revenue==null||s.yes_total_cost_dollars==null||s.fee_cost==null)return null;
  const revenue=Number(s.revenue),cost=Number(s.yes_total_cost_dollars),fee=Number(s.fee_cost);
  if(![revenue,cost,fee].every(Number.isFinite)||revenue<0||cost<0||fee<0)return null;
  const profitCents=Math.floor(revenue-cost*100-fee*100+1e-7);
  return profitCents>0?profitCents:null;
}
