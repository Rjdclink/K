// Exchange-authoritative realized account history, independent of which client
// submitted an order. Never infer a realized win from a live position or from
// an incomplete fill/settlement record.
const number=value=>value===null||value===undefined||value===''?NaN:Number(value);
const date=value=>{if(value===null||value===undefined||value==='')return null;
 const n=new Date(value).getTime();return Number.isFinite(n)?new Date(n):null;};
export function normalizeAccountFill(fill){
 if(!fill||typeof fill!=='object')return null;
 const ticker=String(fill.ticker||fill.market_ticker||'');
 const fillId=String(fill.fill_id||fill.trade_id||'');
 const orderId=String(fill.order_id||'');
 const action=String(fill.action||'').toLowerCase(),side=String(fill.side||'').toLowerCase();
 const count=number(fill.count_fp),fee=number(fill.fee_cost);
 const direct=number(side==='yes'?fill.yes_price_dollars:fill.no_price_dollars);
 const inverse=number(side==='yes'?fill.no_price_dollars:fill.yes_price_dollars);
 const price=Number.isFinite(direct)?direct:Number.isFinite(inverse)?1-inverse:NaN;
 const timestamp=date(fill.created_time||(Number.isFinite(number(fill.ts))?
   new Date(Number(fill.ts)*1000):null));
 if(!ticker||!fillId||!orderId||!['yes','no'].includes(side)||
    !['buy','sell'].includes(action)||!Number.isFinite(count)||count<=0||
    !Number.isFinite(fee)||fee<0||!Number.isFinite(price)||price<0||price>1||!timestamp)return null;
 return {fillId,orderId,ticker,action,side,count,price,fee,createdAt:timestamp.toISOString()};
}
export function realizedAccountMarket(fills,settlement=null){
 if(!Array.isArray(fills)||!fills.length||fills.some(f=>!f||
    !['yes','no'].includes(f.side)||!['buy','sell'].includes(f.action)||
    !Number.isFinite(f.count)||f.count<=0||!Number.isFinite(f.price)||
    f.price<0||f.price>1||!Number.isFinite(f.fee)||f.fee<0||!date(f.createdAt)))return null;
 // Exchange netting can encode a sale of YES as a purchase of NO.
 // Opposing-side fills may return collateral outside this settlement record;
 // without that cash movement, arithmetic could manufacture a loss.
 // Retain legacy results until an exchange-authoritative realized P&L is available.
 if(new Set(fills.map(f=>f.side)).size>1)return null;
 let cash=0,yes=0,no=0,purchases=0;
 for(const f of fills){
   const signed=f.action==='buy'?1:-1;
   if(signed===1)purchases++;
   cash-=signed*f.count*f.price+f.fee;
   if(f.side==='yes')yes+=signed*f.count;else no+=signed*f.count;
 }
 if(!purchases)return null;
 const settled=settlement&&['yes','no'].includes(settlement.market_result)&&
   date(settlement.settled_time)&&Number.isFinite(number(settlement.revenue))&&
   number(settlement.revenue)>=0;
 if(settled){
   // Kalshi settlement revenue is in CENTS, unlike fill prices and fees.
   cash+=number(settlement.revenue)/100;
 }else if(Math.abs(yes)>0.011||Math.abs(no)>0.011)return null;
 const occurred=settled?date(settlement.settled_time):
   fills.map(f=>date(f.createdAt)).sort((a,b)=>b-a)[0];
 return {occurredAt:occurred.toISOString(),profitCents:Math.round(cash*100),
   outcome:settled?'settled':'closed'};
}
export function summarizeAccountMarkets(rawFills,settlements=[]){
 const groups=new Map(),unresolved=new Set();
 const seen=new Set();
 for(const row of rawFills){
  const raw=row?.raw||row,fill=row?.fillId?row:normalizeAccountFill(raw);
  const ticker=String(raw?.ticker||raw?.market_ticker||row?.ticker||'');
  if(!fill){if(ticker)unresolved.add(ticker);continue;}
  if(seen.has(fill.fillId))continue;seen.add(fill.fillId);
  const group=groups.get(fill.ticker)||[];group.push(fill);groups.set(fill.ticker,group);
 }
 const byTicker=new Map(settlements.map(s=>[s.ticker,s.raw||s]));
 const rows=[];
 for(const [ticker,fills]of groups){
  if(unresolved.has(ticker))continue;
  const settlement=byTicker.get(ticker);
  if(settlement&&(!['yes','no'].includes(settlement.market_result)||
     !date(settlement.settled_time)||!Number.isFinite(number(settlement.revenue))||
     number(settlement.revenue)<0)){unresolved.add(ticker);continue;}
  const result=realizedAccountMarket(fills,settlement);
  if(result)rows.push({ticker,...result,fillCount:fills.length,
    firstFillAt:fills.map(f=>f.createdAt).sort()[0]});
  else unresolved.add(ticker);
 }
 return {rows,unresolved:[...unresolved].sort()};
}
