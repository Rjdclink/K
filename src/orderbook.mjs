import {randomUUID} from 'node:crypto';

// Share the empty-book cooldown across broad scans, fast checks and instances.
// A positive summary bypasses this gate; executable depth is still checked at entry.
export function createMissingAskProbe(query){
  let ready;
  return async (tickers,read)=>{
    const unique=[...new Set(tickers.filter(Boolean))];if(!unique.length)return new Map();
    ready??=query(`CREATE TABLE IF NOT EXISTS missing_ask_probes (
      market_ticker text PRIMARY KEY, token uuid NOT NULL, next_probe_at timestamptz NOT NULL)`)
      .catch(error=>{ready=null;throw error});
    await ready;
    const token=randomUUID();
    const {rows}=await query(`INSERT INTO missing_ask_probes(market_ticker,token,next_probe_at)
      SELECT ticker,$2::uuid,clock_timestamp()+interval '10 seconds' FROM unnest($1::text[]) AS ticker ORDER BY ticker
      ON CONFLICT(market_ticker) DO UPDATE SET token=EXCLUDED.token,next_probe_at=EXCLUDED.next_probe_at
      WHERE missing_ask_probes.next_probe_at<=clock_timestamp() RETURNING market_ticker`,[unique,token]);
    const claimed=rows.map(row=>row.market_ticker);if(!claimed.length)return new Map();
    let quotes;
    try{return quotes=await read(claimed)}
    finally{
      const empty=claimed.filter(ticker=>quotes?.get(ticker)===null);
      await query(`UPDATE missing_ask_probes SET next_probe_at=clock_timestamp()+
        CASE WHEN market_ticker=ANY($2::text[]) THEN interval '10 seconds' ELSE interval '0 seconds' END
        WHERE token=$1::uuid AND market_ticker=ANY($3::text[])`,[token,empty,claimed]);
    }
  };
}

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
    return group.map(ticker=>[ticker,found.get(ticker)?.orderbook_fp?bestYesAsk(found.get(ticker).orderbook_fp):undefined]);
  }));
  return new Map(results.flat());
}
