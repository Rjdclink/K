export const marketShard=(event,market)=>Number(market.exchange_index??event.exchange_index??0);
export const comboShardBudget=(localCents,capCents)=>localCents===null?0:Math.max(0,Math.floor(Math.min(localCents,capCents)));
export function shardCash(account,index){
  if(!Array.isArray(account?.balance_breakdown))return null;
  const row=account.balance_breakdown.find(b=>Number(b.exchange_index)===index);
  return row?Math.max(0,Math.floor(Number(row.balance)*100+1e-6)):0;
}
export function transferPlan(account,destination,desiredCents,sourceFloorCents=0){
  const current=shardCash(account,destination);
  if(!Number.isInteger(destination)||destination<0||current===null||!Number.isFinite(desiredCents)||!Number.isFinite(sourceFloorCents)||sourceFloorCents<0)return null;
  const source=account.balance_breakdown.filter(b=>Number(b.exchange_index)!==destination)
    .map(b=>({index:Number(b.exchange_index),cents:Math.floor(Number(b.balance)*100+1e-6)}))
    .filter(b=>Number.isInteger(b.index)&&b.index>=0&&b.cents>sourceFloorCents).sort((a,b)=>b.cents-a.cents)[0];
  if(!source)return null;
  const amountCents=Math.min(Math.max(0,Math.ceil(desiredCents)-current),source.cents-sourceFloorCents);
  return amountCents>0?{sourceShard:source.index,destinationShard:destination,amountCenticents:amountCents*100}:null;
}

// A transfer acknowledgement does not prove the destination can collateralize
// an order. Check its completion and then the actual shard balance.
export async function awaitShardCash({destination,desiredCents,transferId,lookup,readBalance,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=4000}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(transferId){
      const transfer=await lookup(transferId);
      if(transfer?.status==='complete'){
        const balance=await readBalance();
        if(shardCash(balance,destination)>=desiredCents)return balance;
      }
    }else{
      const balance=await readBalance();
      if(shardCash(balance,destination)>=desiredCents)return balance;
    }
    if(Date.now()>=deadline)break;
    await sleep(Math.min(300,deadline-Date.now()));
  }
  return null;
}

