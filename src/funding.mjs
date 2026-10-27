export const marketShard=(event,market)=>Number(market.exchange_index??event.exchange_index??0);
export function shardCash(account,index){
  if(!Array.isArray(account?.balance_breakdown))return null;
  const row=account.balance_breakdown.find(b=>Number(b.exchange_index)===index);
  return row?Math.max(0,Math.floor(Number(row.balance)*100+1e-6)):0;
}
export function transferPlan(account,destination,desiredCents){
  const current=shardCash(account,destination);
  if(!Number.isInteger(destination)||destination<0||current===null||!Number.isFinite(desiredCents))return null;
  const source=account.balance_breakdown.filter(b=>Number(b.exchange_index)!==destination)
    .map(b=>({index:Number(b.exchange_index),cents:Math.floor(Number(b.balance)*100+1e-6)}))
    .filter(b=>Number.isInteger(b.index)&&b.index>=0&&b.cents>0).sort((a,b)=>b.cents-a.cents)[0];
  if(!source)return null;
  const amountCents=Math.min(Math.max(0,Math.ceil(desiredCents)-current),source.cents);
  return amountCents>0?{sourceShard:source.index,destinationShard:destination,amountCenticents:amountCents*100}:null;
}
