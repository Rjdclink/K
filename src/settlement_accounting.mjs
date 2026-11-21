// Canonical Kalshi fixed-point settlement accounting, in DOLLARS except
// settlement.revenue, which is already in CENTS. A matched YES+NO share pair
// releases one dollar of collateral, even when settlement revenue is zero.
// These exact fields have been calibrated against settled position P&L.
const num=value=>value===null||value===undefined||value===''?NaN:Number(value);
// Work in integer millionths of a dollar. Binary floating-point arithmetic
// can turn a true +1.865-dollar result into 186 instead of 187 cents.
const millionths=value=>{
 const scaled=Math.round(value*1_000_000);
 return Number.isSafeInteger(scaled)?scaled:null;
};
const roundedCentsFromMicro=value=>Number.isSafeInteger(value)?
  Math.sign(value)*Math.round(Math.abs(value)/10_000):null;
const instant=value=>{if(value==null||value==='')return null;
 const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;};

export function verifiedSettlementProfit(settlement){
 if(!settlement||!['yes','no'].includes(settlement.market_result))return null;
 const occurredAt=instant(settlement.settled_time);
 if(!occurredAt)return null;
 const no=num(settlement.no_count_fp),yes=num(settlement.yes_count_fp),
   noCost=num(settlement.no_total_cost_dollars),
   yesCost=num(settlement.yes_total_cost_dollars),
   fees=num(settlement.fee_cost),revenueCents=num(settlement.revenue);
 if(![no,yes,noCost,yesCost,fees,revenueCents].every(n=>Number.isFinite(n)&&n>=0))return null;
 // Do not count paired collateral as a settlement payout again.
 // An invalid revenue greater than all potential winning shares fails closed.
 const winning=settlement.market_result==='yes'?yes:no;
 if(revenueCents>Math.max(0,winning-Math.min(no,yes))*100+.011)return null;
 const parts=[Math.min(no,yes),noCost,yesCost,fees,revenueCents/100].map(millionths);
 if(parts.some(n=>n===null))return null;
 const cents=roundedCentsFromMicro(parts[0]-parts[1]-parts[2]-parts[3]+parts[4]);
 return cents===null?null:{occurredAt,profitCents:cents,outcome:'settled'};
}

// Combine separate Kalshi subaccount settlement entries only when result
// and event time agree. Every quantity, cost and fee must be summed; adding
// revenue alone silently understates the cost of partially offset contracts.
// Invalid or conflicting subaccounts are deliberately left unresolved.
export function combineAccountSettlements(rows){
 const groups=new Map(),keys=['revenue','no_count_fp','yes_count_fp',
   'no_total_cost_dollars','yes_total_cost_dollars','fee_cost'];
 for(const s of rows||[]){
  if(!s?.ticker)continue;
  const prior=groups.get(s.ticker);
  if(!prior){groups.set(s.ticker,{...s});continue;}
  const result={...prior};
  if(prior.market_result!==s.market_result||
     prior.settled_time!==s.settled_time||
     keys.some(key=>![num(prior[key]),num(s[key])].every(n=>Number.isFinite(n)&&n>=0))){
    result.revenue=NaN;
  }else{
    for(const key of keys){
      const a=millionths(num(prior[key])),b=millionths(num(s[key]));
      if(a===null||b===null||!Number.isSafeInteger(a+b)){result.revenue=NaN;break}
      result[key]=(a+b)/1_000_000;
    }
  }
  groups.set(s.ticker,result);
 }
 return groups;
}

// Fully paired acquisitions of YES and NO release their collateral before
// settlement. Only a complete, positive-quantity, two-sided offset qualifies.
// Called from a fully paginated account import or direct per-market fill lookup.
export function closedOffsetProfit(fills){
 if(!Array.isArray(fills)||fills.length<2)return null;
 let no=0,yes=0,totalCost=0,fees=0,last=0;
 for(const f of fills){
  if(!['yes','no'].includes(f?.side)||!['buy','sell'].includes(f.action)||!f.fillId||!f.orderId||
    !Number.isFinite(f.count)||f.count<=0||!Number.isFinite(f.price)||
    f.price<0||f.price>1||!Number.isFinite(f.fee)||f.fee<0)return null;
  const at=Date.parse(f.createdAt||'');if(!Number.isFinite(at))return null;
  last=Math.max(last,at);
  if(f.side==='no')no+=f.count;else yes+=f.count;
  totalCost+=f.count*f.price;fees+=f.fee;
 }
 if(no<=0||yes<=0||Math.abs(no-yes)>.011||!last)return null;
 const parts=[Math.min(no,yes),totalCost,fees].map(millionths);
 if(parts.some(n=>n===null))return null;
 const cents=roundedCentsFromMicro(parts[0]-parts[1]-parts[2]);
 return cents===null?null:{occurredAt:new Date(last).toISOString(),
   profitCents:cents,outcome:'closed'};
}
