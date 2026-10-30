// Kalshi combinations are separate YES markets. Two confirmed, still-held
// single fills qualify as legs; an RFQ alone is never a fill.
export const COMBO_WINDOW_MS=12000;
// A fresh quote lives only briefly, but creating markets and waiting for an
// RFQ maker can take longer than the quote freshness window.
export const COMBO_ATTEMPT_MS=45000;
export const VERIFY_DWELL_MS=6000;
export function comboAllocation(completedCombos){return Math.max(2,10-2*Math.max(0,Math.floor(completedCombos)))/100;}
export function comboCandidates(candidates, strategy, max=6){
  const games=new Set(),events=new Set();
  return candidates.filter(c=>{
    if(c.signal.strategy!==strategy || games.has(c.milestone.id) || events.has(c.event.event_ticker))return false;
    games.add(c.milestone.id);events.add(c.event.event_ticker);return true;
  }).slice(0,max);
}
export function filledComboWindow(fills,heldTickers,lastComboAt,max=6){
  const singles=fills.filter(r=>!r.combo_legs&&!/Kalshi-only/i.test(r.reason||'')&&heldTickers.has(r.market_ticker))
    .sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  if(singles.length<2)return [];
  const markets=new Set();
  return singles.filter(r=>{
    if(markets.has(r.market_ticker))return false;
    markets.add(r.market_ticker);return true;
  }).slice(0,max);
}
export function eligibleFillTrigger(ready,singles,group){
  const eligible=new Set(group.map(c=>c.market.ticker));
  const heldById=new Map(singles.map(r=>[r.id,r]));
  return ready.map(r=>heldById.get(r.id)).find(r=>r&&eligible.has(r.market_ticker))||null;
}
export async function collectionsForEvents(eventTickers,get){
  const tickers=[...new Set(eventTickers)].filter(Boolean).slice(0,6);
  const responses=await Promise.all(tickers.map(async ticker=>{
    const rows=[];let cursor='';
    for(let page=0;page<5;page++){
      const query=new URLSearchParams({status:'open',associated_event_ticker:ticker,limit:'200'});
      if(cursor)query.set('cursor',cursor);
      const response=await get('/multivariate_event_collections?'+query);
      rows.push(...response.multivariate_contracts||[]);
      cursor=response.cursor||'';
      if(!cursor)break;
    }
    return rows;
  }));
  return [...new Map(responses.flat().map(c=>[c.collection_ticker,c])).values()];
}
export function comboCollection(collections,legs){
  return (collections||[]).find(c=>(c.is_all_yes===true || c.is_all_yes===false && /every associated market resolves to YES/i.test(String(c.functional_description||''))) &&
    (c.is_single_market_per_event===false || c.is_single_market_per_event===true && new Set(legs.map(l=>l.event.event_ticker)).size===legs.length) &&
    Number(c.size_min)<=legs.length && (!Number(c.size_max)||Number(c.size_max)>=legs.length) &&
    legs.every(l=>(c.associated_events||[]).some(e=>e.ticker===l.event.event_ticker) ||
      (c.associated_event_tickers||[]).includes(l.event.event_ticker)));
}
export function compatibleComboGroups(collections,candidates,maxGroups=6){
  const groups=[];
  const count=Math.min(10,candidates.length);
  for(let mask=1;mask<(1<<count);mask++){
    const legs=candidates.slice(0,count).filter((_,i)=>mask&(1<<i));
    if(legs.length<2||legs.length>6)continue;
    const collection=comboCollection(collections,legs);
    if(collection)groups.push({legs,collection});
  }
  return groups.sort((a,b)=>b.legs.length-a.legs.length).slice(0,maxGroups);
}
export function selectedComboMarkets(legs){
  return legs.map(c=>({event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,side:'yes'}));
}
export function heldComboLeg(row,market,snapshot={}){
  if(!row||Number(row.fill_count)<=0||!market||market.ticker!==row.market_ticker||market.event_ticker!==row.event_ticker||
    !['active','open'].includes(market.status)||market.result&&!['','not_determined'].includes(String(market.result)))return null;
  return {milestone:{id:row.game_id},event:{event_ticker:row.event_ticker},market,
    signal:{strategy:row.strategy},state:{title:snapshot.title||row.sport||row.event_ticker,sport:row.sport||snapshot.sport||'',
      type:snapshot.sport_family||'',remainingSeconds:snapshot.clock_seconds==null?NaN:Number(snapshot.clock_seconds)}};
}
export function quoteForYes(quote,ticker,budgetCents,feeMultiplier=2,bankrollCents=budgetCents){
  if(!quote || quote.market_ticker!==ticker || quote.status!=='open')return null;
  // The maker's NO bid is the price at which the RFQ creator buys YES.
  const noBid=Number(quote.no_bid_dollars),count=Number(quote.no_contracts_fp??quote.contracts_fp);
  const created=Date.parse(quote.created_ts||'');
  if(!Number.isFinite(noBid)||noBid<=0||noBid>=1||!Number.isFinite(count)||count<=0||
    !Number.isFinite(created)||Date.now()-created>COMBO_WINDOW_MS)return null;
  const yesCost=1-noBid;
  // Conservative fee ceiling; the exchange can reject or leave the quote unfilled.
  const feeCents=Math.ceil(feeMultiplier*7*count*yesCost*(1-yesCost));
  const debitCents=Math.ceil(100*count*yesCost)+feeCents;
  const profitCents=Math.floor(100*count-debitCents);
  if(debitCents>budgetCents||profitCents<=0)return null;
  return {count,yesCost,debitCents,profitCents};
}
export function comboLegs(legs){return legs.map(c=>({game_id:c.milestone.id,event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,strategy:c.signal.strategy,title:c.state.title,sport:c.state.sport}));}

