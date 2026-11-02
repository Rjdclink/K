// An executable YES sale uses resting YES bids, capped by the held quantity.
export function sellQuote(book,held,whole=false){
  const levels=(book?.yes_dollars||[]).map(([p,n])=>[Number(p),Number(n)]).filter(([p,n])=>Number.isFinite(p)&&p>0&&p<1&&Number.isFinite(n)&&n>0).sort((a,b)=>b[0]-a[0]);
  if(!levels.length||!Number.isFinite(held)||held<=0)return null;
  const price=levels[0][0],size=levels.filter(l=>l[0]===price).reduce((s,l)=>s+l[1],0);
  const count=Math.floor(Math.min(held,size)*(whole?1:100)+1e-7)/(whole?1:100);
  return count>0?{price,count}:null;
}
// Manual cash-out quotes cover the executable quantity across all bid levels.
// The order limit is the lowest included bid, rather than its average price.
export function cashoutQuote(book,held,whole=false){
  if(!Number.isFinite(held)||held<=0)return null;
  const levels=(book?.yes_dollars||[]).map(([p,n])=>({price:Number(p),count:Number(n)}))
    .filter(x=>Number.isFinite(x.price)&&x.price>0&&x.price<1&&Number.isFinite(x.count)&&x.count>0)
    .sort((a,b)=>b.price-a.price);
  const fills=[];let remaining=held,gross=0,count=0;
  for(const level of levels){
    const quantity=Math.floor(Math.min(level.count,remaining)*(whole?1:100)+1e-7)/(whole?1:100);
    if(quantity<=0)continue;
    fills.push({price:level.price,count:quantity});count+=quantity;remaining-=quantity;gross+=quantity*level.price*100;
    if(remaining<(whole?1:.01)-1e-8)break;
  }
  return fills.length?{price:fills.at(-1).price,count:Number(count.toFixed(2)),average_price:gross/count/100,gross_cents:gross,levels:fills,partial:count<held-1e-8}:null;
}
