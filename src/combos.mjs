// Kalshi combinations are separate YES markets. Two confirmed, still-held
// single fills qualify as legs; an RFQ alone is never a fill.
export const COMBO_WINDOW_MS=12000;
// A fresh quote lives only briefly, but creating markets and waiting for an
// RFQ maker can take longer than the quote freshness window.
export const COMBO_ATTEMPT_MS=45000;
export const VERIFY_DWELL_MS=6000;
export function comboAllocation(){return .20;}
export function comboAllowedCents(fraction,bankrollCents){return Math.floor(fraction*bankrollCents);}
// Maker RFQs quote close to target cost; leave room for the fee before asking.
export function comboRfqTargetCents(budgetCents){return Math.max(0,Math.floor(budgetCents*.97));}
export function comboLegAllocation(legs,verifiedFraction){
  if(legs.length>=2&&legs.every(c=>c.signal?.robustOver===true&&
    (c.signal?.kalshiOnly!==true||c.signal?.externallyVerified===true)))return .40;
  return legs.some(c=>c.signal?.kalshiOnly&&!c.signal?.externallyVerified)?.15:verifiedFraction;
}
export function remainingVerifiedComboCents(position,bankroll){
  const held=Number(position?.position_fp),exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(!Number.isFinite(held)||held<=0||position?.market_exposure_dollars==null||
    position?.fees_paid_dollars==null||!Number.isFinite(exposure)||exposure<0||
    !Number.isFinite(fees)||fees<0||!Number.isFinite(bankroll)||bankroll<=0)return 0;
  return Math.max(0,Math.floor(bankroll*.20)-Math.ceil(exposure*100)-Math.ceil(fees*100));
}
export function availableComboFills(fills,usedLegTickers){
  return fills.filter(r=>!(/Kalshi-only/i.test(r.reason||'')&&r.externally_verified!==true&&usedLegTickers.has(r.market_ticker)));
}
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
export function prioritizedComboGroups(groups,maxLarger=5){
  return [...groups.filter(g=>g.legs.length===2),...groups.filter(g=>g.legs.length>2).slice(0,maxLarger)];
}
export function comboPairDiagnostics(collections,candidates){
  const pairs=[];
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
    const legs=[candidates[i],candidates[j]];
    pairs.push({tickers:legs.map(c=>c.market.ticker).sort(),collection:comboCollection(collections,legs)?.collection_ticker||null});
  }
  return pairs;
}
export function selectedComboMarkets(legs){
  return legs.map(c=>({event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,side:'yes'}));
}
export async function liveComboMarket(get,ticker){
  try{
    const {market}=await get('/markets/'+encodeURIComponent(ticker));
    return market?.ticker===ticker&&['active','open'].includes(market.status)?market:null;
  }catch(e){
    // A newly created multivariate market can briefly be absent from GET.
    if(/^Kalshi (404|410) GET \/markets\//.test(String(e.message)))return null;
    throw e;
  }
}
export function heldComboLeg(row,market,snapshot={}){
  if(!row||Number(row.fill_count)<=0||!market||market.ticker!==row.market_ticker||market.event_ticker!==row.event_ticker||
    !['active','open'].includes(market.status)||market.result&&!['','not_determined'].includes(String(market.result)))return null;
  // A corrected soccer goal can uncross a held total. Never compound that
  // position into a fresh all-YES ticket while the observed total is below the line.
  const series=String(market.event_ticker||'').split('-')[0];
  if(row.strategy==='over'&&/soccer/.test(String(snapshot.sport_family||''))&&
    /TOTAL$/.test(series)&&!/(?:TEAM|[1-9](?:Q|P|H|INNING))TOTAL$/.test(series)&&
    (snapshot.status!=='live'||Date.now()-Date.parse(snapshot.scanned_at||'')>90000||
      snapshot.home==null||snapshot.away==null||market.floor_strike==null||
      !Number.isFinite(Number(snapshot.home))||!Number.isFinite(Number(snapshot.away))||
      Number(snapshot.home)+Number(snapshot.away)<=Number(market.floor_strike)))return null;
  const kalshiOnly=/Kalshi-only/i.test(row.reason||'');
  const freshSnapshot=snapshot.status==='live'&&Date.now()-Date.parse(snapshot.scanned_at||'')<90000;
  const robustOver=row.strategy==='over'&&Number(row.fraction)===.40&&
    /still crossed if the latest \d+-unit scoring play is removed/i.test(row.reason||'')&&
    freshSnapshot&&(snapshot.signals||[]).some(s=>s.ticker===row.market_ticker&&
      /still crossed if the latest \d+-unit scoring play is removed/i.test(s.reason||''));
  return {milestone:{id:row.game_id},event:{event_ticker:row.event_ticker},market,
    signal:{strategy:row.strategy,kalshiOnly,externallyVerified:!kalshiOnly||row.externally_verified===true,robustOver},state:{title:snapshot.title||row.sport||row.event_ticker,sport:row.sport||snapshot.sport||'',
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
export function comboLegs(legs){return legs.map(c=>({game_id:c.milestone.id,event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,strategy:c.signal.strategy,title:c.state.title,sport:c.state.sport,kalshiOnly:c.signal.kalshiOnly===true}));}

