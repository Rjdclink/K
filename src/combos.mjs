// Kalshi combinations are separate YES markets. A quote is executable only while
// every component still qualifies; an RFQ alone is never a fill.
export const COMBO_WINDOW_MS=12000;
export function comboCandidates(candidates, strategy, max=6){
  const games=new Set(),events=new Set();
  return candidates.filter(c=>{
    if(c.signal.strategy!==strategy || games.has(c.milestone.id) || events.has(c.event.event_ticker))return false;
    games.add(c.milestone.id);events.add(c.event.event_ticker);return true;
  }).slice(0,max);
}
export function filledComboWindow(fills,heldTickers,lastComboAt,max=6){
  const singles=fills.filter(r=>!r.combo_legs&&heldTickers.has(r.market_ticker))
    .sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  if(singles.length<2 || lastComboAt && singles.filter(r=>new Date(r.updated_at)>new Date(lastComboAt)).length<2)return [];
  const games=new Set(),events=new Set();
  return singles.filter(r=>{
    if(games.has(r.game_id)||events.has(r.event_ticker))return false;
    games.add(r.game_id);events.add(r.event_ticker);return true;
  }).slice(0,max);
}
export function comboCollection(collections,legs){
  return (collections||[]).find(c=>c.is_all_yes===true && c.is_single_market_per_event===true &&
    Number(c.size_min)<=legs.length && (!Number(c.size_max)||Number(c.size_max)>=legs.length) &&
    legs.every(l=>(c.associated_event_tickers||[]).includes(l.event.event_ticker)));
}
export function quoteForYes(quote,ticker,budgetCents,feeMultiplier=2){
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
