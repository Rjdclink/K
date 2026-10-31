import { createHash } from 'node:crypto';
// Kalshi combinations are separate YES markets. Two confirmed, still-held
// single fills qualify as legs; an RFQ alone is never a fill.
// Creating markets and waiting for an RFQ maker can take longer than a scan.
export const COMBO_ATTEMPT_MS=45000;
export const VERIFY_DWELL_MS=10000;
// Bound RFQs per attempt, not the number of distinct held singles considered.
export const COMBO_RFQ_PLANS=12;
export function comboAllocation(){return .15;}
export function comboAllowedCents(fraction,bankrollCents){return Math.floor(fraction*bankrollCents);}
// Maker RFQs quote close to target cost; leave room for the fee before asking.
export function comboRfqTargetCents(budgetCents){return Math.max(0,Math.floor(budgetCents*.97));}
export function comboLegAllocation(legs,verifiedFraction){
  return Math.min(.15,verifiedFraction);
}
export function remainingVerifiedComboCents(position,bankroll){
  const held=Number(position?.position_fp),exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(!Number.isFinite(held)||held<=0||position?.market_exposure_dollars==null||
    position?.fees_paid_dollars==null||!Number.isFinite(exposure)||exposure<0||
    !Number.isFinite(fees)||fees<0||!Number.isFinite(bankroll)||bankroll<=0)return 0;
  return Math.max(0,Math.floor(bankroll*.15)-Math.ceil(exposure*100)-Math.ceil(fees*100));
}
export function availableComboFills(fills,usedLegTickers){
  return fills.filter(r=>!/Restricted 20% cricket final innings/i.test(r.reason||'')&&
    !(/Kalshi-only/i.test(r.reason||'')&&r.externally_verified!==true&&usedLegTickers.has(r.market_ticker)));
}
export function comboCandidates(candidates, strategy, max=6){
  const games=new Set(),events=new Set();
  return candidates.filter(c=>{
    if(c.signal.strategy!==strategy || games.has(c.milestone.id) || events.has(c.event.event_ticker))return false;
    games.add(c.milestone.id);events.add(c.event.event_ticker);return true;
  }).slice(0,max);
}
export function filledComboWindow(fills,heldTickers,lastComboAt,max=Infinity){
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
export function missingQuoteFill(fills,ticker,createdAt){
  const start=new Date(createdAt).getTime()-1000;
  if(!Number.isFinite(start))return null;
  const buys=(fills||[]).filter(f=>f.ticker===ticker&&f.action==='buy'&&
    (f.outcome_side==='yes'||f.side==='yes')&&f.order_id&&
    Number.isFinite(Date.parse(f.created_time||f.ts||''))&&Date.parse(f.created_time||f.ts)>=start&&
    Number(f.count_fp??f.count)>0);
  const orderId=buys[0]?.order_id;
  if(!orderId)return null;
  return {orderId,count:buys.filter(f=>f.order_id===orderId).reduce((sum,f)=>sum+Number(f.count_fp??f.count),0)};
}
export async function collectionsForEvents(eventTickers,get){
  const tickers=[...new Set(eventTickers)].filter(Boolean);
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
function contractTerms(m){
  return {ticker:m.ticker,event:m.event_ticker,type:m.strike_type,floor:m.floor_strike,cap:m.cap_strike,
    custom:Object.entries(m.custom_strike||{}).sort(([a],[b])=>a.localeCompare(b)),
    rules:m.rules_primary,secondary:m.rules_secondary,close:m.close_time};
}
export function comboExclusionKey(legs){
  const terms=legs.map(l=>contractTerms(l.market)).sort((a,b)=>a.ticker.localeCompare(b.ticker));
  return createHash('sha256').update(JSON.stringify(terms)).digest('hex');
}
export function comboGroupRejection(legs){
  for(const {market:m,comboExcluded} of legs){
    if(comboExcluded)return 'already_decided';
    if(m.status&&!['active','open'].includes(m.status)||m.result&&!['not_determined'].includes(m.result))return 'already_decided';
  }
  for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
    const a=legs[i].market,b=legs[j].market;
    if(a.ticker===b.ticker)return 'duplicate_leg';
    // Only infer implication for the same contract family, subject, rules,
    // and direction. Different players/teams/periods remain independent legs.
    if(!a.event_ticker||a.event_ticker!==b.event_ticker||a.strike_type!=='greater'||b.strike_type!=='greater'||
      a.floor_strike==null||b.floor_strike==null||!Number.isFinite(Number(a.floor_strike))||!Number.isFinite(Number(b.floor_strike))||
      a.cap_strike!=null||b.cap_strike!=null||!a.rules_primary||!b.rules_primary)continue;
    const ta=contractTerms(a),tb=contractTerms(b);
    ta.ticker=tb.ticker='';ta.floor=tb.floor=null;
    ta.rules=ta.rules.split(String(a.floor_strike)).join('<threshold>');
    tb.rules=tb.rules.split(String(b.floor_strike)).join('<threshold>');
    if(JSON.stringify(ta)===JSON.stringify(tb))return 'redundant_legs';
  }
  return null;
}
export function exchangeComboExclusion(error,legs){
  const message=String(error?.message||error);
  if(!/^Kalshi 400 POST \/multivariate_event_collections\//.test(message))return null;
  const status=/already (?:been )?decided/i.test(message)?'already_decided':/already guarantees/i.test(message)?'redundant_legs':null;
  if(!status)return null;
  let details;try{details=JSON.parse(message.split(' details=')[1])}catch{return null}
  if(typeof details!=='string')return null;
  const tickers=details.split(',').map(s=>s.trim());
  const selected=legs.filter(l=>tickers.includes(l.market.ticker));
  if(selected.length!==tickers.length||(status==='already_decided'?selected.length!==1:selected.length<2))return null;
  return {key:comboExclusionKey(selected),status,tickers,detail:message};
}
export function comboCollection(collections,legs){
  if(comboGroupRejection(legs))return null;
  return (collections||[]).find(c=>(c.is_all_yes===true || c.is_all_yes===false && /every associated market resolves to YES/i.test(String(c.functional_description||''))) &&
    (c.is_single_market_per_event===false || c.is_single_market_per_event===true && new Set(legs.map(l=>l.event.event_ticker)).size===legs.length) &&
    Number(c.size_min)<=legs.length && (!Number(c.size_max)||Number(c.size_max)>=legs.length) &&
    legs.every(l=>(c.associated_events||[]).some(e=>e.ticker===l.event.event_ticker) ||
      (c.associated_event_tickers||[]).includes(l.event.event_ticker)));
}
export function compatibleComboGroups(collections,candidates,maxGroups=6){
  const groups=[];
  const count=candidates.length;
  const visit=(start,legs,size)=>{
    if(groups.length>=maxGroups)return;
    if(legs.length===size){const collection=comboCollection(collections,legs);if(collection)groups.push({legs:[...legs],collection});return}
    for(let i=start;i<=count-(size-legs.length);i++){
      legs.push(candidates[i]);visit(i+1,legs,size);legs.pop();
      if(groups.length>=maxGroups)return;
    }
  };
  for(let size=count;size>=2&&groups.length<maxGroups;size--)visit(0,[],size);
  return groups;
}
function combinationCount(n,k){
  let result=1n;for(let i=1;i<=k;i++)result=result*BigInt(n-i+1)/BigInt(i);return result;
}
function combinationAt(items,k,index){
  const chosen=[];let start=0;
  for(let remaining=k;remaining>0;remaining--){
    for(let i=start;i<=items.length-remaining;i++){
      const count=combinationCount(items.length-i-1,remaining-1);
      if(index>=count){index-=count;continue}
      chosen.push(items[i]);start=i+1;break;
    }
  }
  return chosen;
}
export function plannedComboGroups(collections,candidates,maxPlans=COMBO_RFQ_PLANS,rotation=0,excluded=new Set(),requiredTicker=null){
  const compatible=(collections||[]).filter(c=>c.is_all_yes===true ||
    c.is_all_yes===false&&/every associated market resolves to YES/i.test(String(c.functional_description||'')));
  const eligible=compatible.map(collection=>{
    const events=new Set([...(collection.associated_events||[]).map(e=>e.ticker),...(collection.associated_event_tickers||[])]);
    const items=candidates.filter(candidate=>events.has(candidate.event.event_ticker));
    if(requiredTicker)items.sort((a,b)=>Number(b.market.ticker===requiredTicker)-Number(a.market.ticker===requiredTicker));
    const pools=collection.is_single_market_per_event===true?
      [...Map.groupBy(items,item=>item.event.event_ticker).values()]:items.map(item=>[item]);
    return {collection,pools};
  }).filter(({pools})=>pools.length>=2&&(!requiredTicker||pools.some(pool=>pool.some(c=>c.market.ticker===requiredTicker))));
  const maxSize=Math.max(0,...eligible.map(({collection,pools})=>Math.min(pools.length,Number(collection.size_max)||pools.length)));
  const sizes=[];for(let size=maxSize;size>=2;size--)if(eligible.some(({collection,pools})=>
    Number(collection.size_min)<=size&&pools.length>=size&&(!Number(collection.size_max)||Number(collection.size_max)>=size)))sizes.push(size);
  const selected=[],seen=new Set(),offset=requiredTicker?0:Math.max(0,Math.trunc(rotation));
  // Reserve a pair slot if a collection offers pairs, even when many larger
  // sizes exist. A market can receive a maker quote at one size but not another.
  const middle=sizes.slice(1,-1);
  const middleSlots=Math.max(0,maxPlans-2);
  const orderedSizes=sizes.length>maxPlans&&sizes.at(-1)===2&&middle.length?
    [sizes[0],...Array.from({length:middleSlots},(_,i)=>middle[(offset*middleSlots+i)%middle.length]).sort((a,b)=>b-a),2]:sizes;
  for(let index=0;index<orderedSizes.length;index++){
    const size=orderedSizes[index],remainingSizes=orderedSizes.length-index-1;
    // Give every available ticket size at least one plan, preferably two.
    // Use the rest of the RFQ budget instead of silently stopping at two.
    const reserve=Math.min(Math.max(0,maxPlans-selected.length-1),remainingSizes*2);
    const quota=Math.max(0,maxPlans-selected.length-reserve);
    if(quota<=0)continue;
    const start=eligible.length?offset%eligible.length:0;
    let added=0;
    // Interleave collections so one broad collection cannot consume every
    // slot before another valid set of held legs is tried.
    for(let step=0;step<64&&added<quota;step++)for(let c=0;c<eligible.length&&added<quota;c++){
      const {collection,pools}=eligible[(start+c)%eligible.length];
      if(pools.length<size||Number(collection.size_min)>size||Number(collection.size_max)&&Number(collection.size_max)<size)continue;
      const total=combinationCount(pools.length,size);
      if(BigInt(step)>=total)continue;
        const rank=(BigInt(offset)*2n+BigInt(step))%total;
        const legs=combinationAt(pools,size,rank).map((pool,i)=>pool[(offset+step+i)%pool.length]);
        if(requiredTicker&&!legs.some(leg=>leg.market.ticker===requiredTicker))continue;
        if(!comboCollection([collection],legs)||excluded.has(comboExclusionKey(legs)))continue;
        if(legs.some((a,i)=>legs.slice(i+1).some(b=>excluded.has(comboExclusionKey([a,b])))))continue;
        const key=legs.map(l=>l.market.ticker).sort().join('|');
        if(seen.has(key))continue;
        seen.add(key);selected.push({legs,collection});added++;
    }
  }
  return selected;
}
export function prioritizedComboGroups(groups,maxPlans=12,rotation=0){
  const bySize=new Map();
  for(const group of groups){const n=group.legs.length;const bucket=bySize.get(n)||[];bucket.push(group);bySize.set(n,bucket)}
  const sizes=[...bySize.keys()].sort((a,b)=>b-a),chosen=[];
  // A few from each permitted size on every pass. Rotate within each size
  // so the bounded RFQ window eventually reaches every distinct leg set.
  for(const size of sizes){
    const bucket=bySize.get(size),count=Math.min(2,bucket.length,maxPlans-chosen.length);
    if(!count)break;
    const start=((rotation*2)%bucket.length+bucket.length)%bucket.length;
    for(let i=0;i<count;i++)chosen.push(bucket[(start+i)%bucket.length]);
  }
  return chosen;
}
export function comboPairDiagnostics(collections,candidates){
  const pairs=[];
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
    const legs=[candidates[i],candidates[j]];
    const rejection=comboGroupRejection(legs);
    pairs.push({tickers:legs.map(c=>c.market.ticker).sort(),collection:comboCollection(collections,legs)?.collection_ticker||null,
      ...(rejection?{rejection}:{})});
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
  if(/Restricted 20% cricket final innings/i.test(row.reason||''))return null;
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
  if(!Number.isFinite(noBid)||noBid<=0||noBid>=1||!Number.isFinite(count)||count<=0||
    !Number.isFinite(Date.parse(quote.created_ts||'')))return null;
  // Quote creation time is not an expiration. The fresh RFQ list says whether
  // it is open; Kalshi validates that status again when we accept it.
  const yesCost=1-noBid;
  // Conservative fee ceiling; the exchange can reject or leave the quote unfilled.
  const feeCents=Math.ceil(feeMultiplier*7*count*yesCost*(1-yesCost));
  const debitCents=Math.ceil(100*count*yesCost)+feeCents;
  const profitCents=Math.floor(100*count-debitCents);
  if(debitCents>budgetCents||profitCents<=0)return null;
  return {count,yesCost,debitCents,profitCents};
}
export function comboLegs(legs){return legs.map(c=>({game_id:c.milestone.id,event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,strategy:c.signal.strategy,title:c.state.title,sport:c.state.sport,kalshiOnly:c.signal.kalshiOnly===true}));}

