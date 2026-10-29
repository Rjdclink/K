// An executable YES sale uses resting YES bids, capped by the held quantity.
export function sellQuote(book,held,whole=false){
  const levels=(book?.yes_dollars||[]).map(([p,n])=>[Number(p),Number(n)]).filter(([p,n])=>Number.isFinite(p)&&p>0&&p<1&&Number.isFinite(n)&&n>0).sort((a,b)=>b[0]-a[0]);
  if(!levels.length||!Number.isFinite(held)||held<=0)return null;
  const price=levels[0][0],size=levels.filter(l=>l[0]===price).reduce((s,l)=>s+l[1],0);
  const count=Math.floor(Math.min(held,size)*(whole?1:100)+1e-7)/(whole?1:100);
  return count>0?{price,count}:null;
}
