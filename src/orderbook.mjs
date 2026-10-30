// Kalshi exposes YES offers as resting NO bids at complementary prices.
export function yesDepthAtAsk(orderbook,ask,size){
  const price=Number(ask),advertised=Number(size);
  if(!Array.isArray(orderbook?.no_dollars)||!Number.isFinite(price)||!Number.isFinite(advertised)||price<=0||price>=1)return 0;
  const depth=orderbook.no_dollars.reduce((sum,level)=>{
    if(!Array.isArray(level)||level.length<2)return sum;
    const bid=Number(level[0]),count=Number(level[1]);
    return Number.isFinite(bid)&&Number.isFinite(count)&&count>0&&10000-Math.round(bid*10000)<=Math.round(price*10000)?sum+count:sum;
  },0);
  return Math.max(0,Math.floor(Math.min(depth,advertised)*100+1e-7)/100);
}
export function bestYesAsk(orderbook){
  if(!Array.isArray(orderbook?.no_dollars))return null;
  const levels=orderbook.no_dollars.map(([price,size])=>({bid:Number(price),size:Number(size)}))
    .filter(x=>Number.isFinite(x.bid)&&x.bid>0&&x.bid<1&&Number.isFinite(x.size)&&x.size>0)
    .sort((a,b)=>b.bid-a.bid);
  if(!levels.length)return null;
  const best=levels[0];
  const size=levels.filter(x=>Math.round(x.bid*10000)===Math.round(best.bid*10000)).reduce((sum,x)=>sum+x.size,0);
  return {price:Number((1-best.bid).toFixed(4)),size:Math.floor(size*100+1e-7)/100};
}
// Cover every candidate, including games with many crossed markets. A partial
// batch response or unsupported batch endpoint falls back to individual books.
export async function bestAsksForTickers(tickers,fetchBatch,fetchOne,onError=()=>{}){
  const unique=[...new Set(tickers.filter(Boolean))],groups=[];
  for(let i=0;i<unique.length;i+=100)groups.push(unique.slice(i,i+100));
  const results=await Promise.all(groups.map(async group=>{
    let books=[];
    try{
      books=await fetchBatch(group);
      if(!Array.isArray(books))throw Error('Batch orderbooks response missing');
    }catch(error){onError('batch',error);}
    const found=new Map(books.filter(book=>group.includes(book?.ticker)).map(book=>[book.ticker,book]));
    const absent=group.filter(ticker=>!found.has(ticker));
    await Promise.all(absent.map(async ticker=>{
      try{found.set(ticker,await fetchOne(ticker))}
      catch(error){onError(ticker,error);found.set(ticker,null)}
    }));
    return group.map(ticker=>[ticker,bestYesAsk(found.get(ticker)?.orderbook_fp)]);
  }));
  return new Map(results.flat());
}
