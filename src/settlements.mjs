export function favorableSettlement(s){
  const side=s?.market_result;
  if(!['yes','no'].includes(side)||!Number.isFinite(Number(s[`${side}_count_fp`]))||Number(s[`${side}_count_fp`])<=0)return null;
  if(s.revenue==null||s[`${side}_total_cost_dollars`]==null||s.fee_cost==null)return null;
  const revenue=Number(s.revenue),cost=Number(s[`${side}_total_cost_dollars`]),fee=Number(s.fee_cost);
  if(![revenue,cost,fee].every(Number.isFinite)||revenue<0||cost<0||fee<0)return null;
  const profitCents=Math.floor(revenue-cost*100-fee*100+1e-7);
  return profitCents>0?profitCents:null;
}
