import { createHash } from 'node:crypto';
// Kalshi combinations are separate YES markets. Two confirmed, still-held
// single fills qualify as legs; an RFQ alone is never a fill.
// Creating markets and waiting for an RFQ maker can take longer than a scan.
export const COMBO_ATTEMPT_MS=45000;
export const VERIFY_DWELL_MS=10000;
// Bound RFQs per attempt, not the number of distinct held singles considered.
export const COMBO_RFQ_PLANS=12;
export const COMBO_CASH_RESERVE_CENTS=700;
export const singleSpendableCash=cash=>Math.max(0,Math.floor(Number(cash)||0)-COMBO_CASH_RESERVE_CENTS);
export function comboAllocation(){return .35;}
export function comboAllowedCents(fraction,bankrollCents){return Math.floor(fraction*bankrollCents);}
export function comboMinimumCents(fraction,bankrollCents){return fraction===comboAllocation()?Math.ceil(.10*bankrollCents):0;}
export function comboMeetsMinimum(fraction,bankrollCents,newCostCents,heldCostCents=0){
  return heldCostCents+newCostCents>=comboMinimumCents(fraction,bankrollCents);
}
// Maker RFQs quote close to target cost; leave room for the fee before asking.
export function comboRfqTargetCents(budgetCents){return Math.max(0,Math.floor(budgetCents*.97));}
export function comboQuotePath(rfqId){return '/communications/quotes?'+new URLSearchParams({rfq_id:rfqId,rfq_user_filter:'self',limit:'100'});}
export function comboLegAllocation(legs,verifiedFraction){
  // Crossed overs retain their own 15% combination ceiling. A winner combo
  // gets 35% only if every leg has an independent verification record.
  return Math.min(verifiedFraction,legs.length&&legs.every(l=>l.signal?.strategy==='lead'&&
    l.signal.externallyVerified===true)?.35:.15);
}
export function comboHeldFraction(legs){return comboLegAllocation(legs.map(l=>({signal:{strategy:l.strategy,
  externallyVerified:l.externallyVerified===true||l.kalshiOnly===false}})),comboAllocation())}
export function remainingVerifiedComboCents(position,bankroll,fraction=.15){
  const held=Number(position?.position_fp),exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(!Number.isFinite(held)||held<=0||position?.market_exposure_dollars==null||
    position?.fees_paid_dollars==null||!Number.isFinite(exposure)||exposure<0||
    !Number.isFinite(fees)||fees<0||!Number.isFinite(bankroll)||bankroll<=0)return 0;
  return Math.max(0,Math.floor(bankroll*fraction)-Math.ceil(exposure*100)-Math.ceil(fees*100));
}
export function availableComboFills(fills){
  return fills.filter(r=>!/Restricted 20% cricket final innings/i.test(r.reason||''));
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
  const orderIds=[...new Set(buys.map(f=>f.order_id))];
  if(orderIds.length!==1)return null;
  const orderId=orderIds[0];
  return {orderId,count:buys.filter(f=>f.order_id===orderId).reduce((sum,f)=>sum+Number(f.count_fp??f.count),0)};
}
export async function comboFillPages(get,ticker,createdAt){
  const fills=[],seen=new Set();let cursor='';
  for(let page=0;page<10;page++){
    const query=new URLSearchParams({ticker,min_ts:String(Math.floor(new Date(createdAt).getTime()/1000)-60),limit:'1000'});if(cursor)query.set('cursor',cursor);
    const data=await get('/portfolio/fills?'+query);fills.push(...data.fills||[]);cursor=data.cursor||'';
    if(!cursor)return fills;if(seen.has(cursor))break;seen.add(cursor);
  }
  throw Error('Combo fills exceed pagination safety limit');
}
export async function collectionsForEvents(eventTickers,get){
  const tickers=[...new Set(eventTickers)].filter(Boolean);
  const responses=await Promise.all(tickers.map(async ticker=>{
    const rows=[],seen=new Set();let cursor='';
    for(;;){
      const query=new URLSearchParams({status:'open',associated_event_ticker:ticker,limit:'200'});
      if(cursor)query.set('cursor',cursor);
      const response=await get('/multivariate_event_collections?'+query);
      rows.push(...response.multivariate_contracts||[]);
      cursor=response.cursor||'';
      if(!cursor)break;
      if(seen.has(cursor))throw Error('Combo collection pagination did not advance');
      seen.add(cursor);
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
function collectionIdentity(c){
  return {ticker:c.collection_ticker,allYes:c.is_all_yes,description:c.functional_description,
    onePerEvent:c.is_single_market_per_event,min:c.size_min,max:c.size_max,
    events:[...new Set([...(c.associated_events||[]).map(e=>e.ticker),...(c.associated_event_tickers||[])])].sort()};
}
// Count every contract choice, not merely every event choice. Weighted suffix
// counts let us unrank a subset without enumerating its exponential siblings.
function comboSpaces(collections,candidates,requiredTicker){
  const unique=[...new Map(candidates.map(c=>[c.market.ticker,c])).values()]
    .sort((a,b)=>a.market.ticker.localeCompare(b.market.ticker));
  const spaces=[];
  for(const collection of [...collections].sort((a,b)=>a.collection_ticker.localeCompare(b.collection_ticker))){
    if(!(collection.is_all_yes===true||collection.is_all_yes===false&&/every associated market resolves to YES/i.test(String(collection.functional_description||''))))continue;
    const events=new Set(collectionIdentity(collection).events);
    const items=unique.filter(c=>events.has(c.event.event_ticker));
    const anchor=requiredTicker?items.find(c=>c.market.ticker===requiredTicker):null;
    if(requiredTicker&&!anchor)continue;
    const remaining=items.filter(c=>c!==anchor&&(!anchor||collection.is_single_market_per_event!==true||c.event.event_ticker!==anchor.event.event_ticker));
    const pools=collection.is_single_market_per_event===true?
      [...Map.groupBy(remaining,c=>c.event.event_ticker).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,p])=>p):remaining.map(c=>[c]);
    const min=Math.max(2,Number(collection.size_min)||2),max=Math.min(pools.length+(anchor?1:0),Number(collection.size_max)||Infinity);
    if(max<min)continue;
    const dp=Array.from({length:pools.length+1},()=>Array(max+1).fill(0n));
    dp[pools.length][0]=1n;
    for(let i=pools.length-1;i>=0;i--){dp[i][0]=1n;
      for(let k=1;k<=max;k++)dp[i][k]=dp[i+1][k]+BigInt(pools[i].length)*dp[i+1][k-1];
    }
    for(let size=max;size>=min;size--){
      const k=size-(anchor?1:0),total=dp[0][k];if(!total)continue;
      const key=createHash('sha256').update(JSON.stringify({collection:collectionIdentity(collection),size,requiredTicker})).digest('hex');
      const at=rank=>{
        const legs=anchor?[anchor]:[];let left=k;
        for(let i=0;left>0&&i<pools.length;i++){
          const suffix=dp[i+1][left-1],block=BigInt(pools[i].length)*suffix;
          if(rank>=block){rank-=block;continue}
          const choice=Number(rank/suffix);rank%=suffix;legs.push(pools[i][choice]);left--;
        }
        return legs.sort((a,b)=>a.market.ticker.localeCompare(b.market.ticker));
      };
      spaces.push({key,size,total,at,collection});
    }
  }
  return spaces.sort((a,b)=>b.size-a.size||a.key.localeCompare(b.key));
}
export function comboPlannerScope(collections,candidates,requiredTicker=null){
  return createHash('sha256').update(JSON.stringify({version:2,requiredTicker,
    collections:collections.map(collectionIdentity).sort((a,b)=>a.ticker.localeCompare(b.ticker)),
    contracts:candidates.map(c=>contractTerms(c.market)).sort((a,b)=>a.ticker.localeCompare(b.ticker))})).digest('hex');
}
export function nextComboBatch(collections,candidates,{cursor={},maxPlans=COMBO_RFQ_PLANS,maxExamined=2048,
  excluded=new Set(),known=new Set(),requiredTicker=null}={}){
  const spaces=comboSpaces(collections,candidates,requiredTicker),ranks={...cursor.ranks},selected=[],seen=new Set();
  let next=Math.max(0,Number(cursor.next)||0),examined=0,idle=0;
  while(spaces.length&&selected.length<maxPlans&&examined<maxExamined&&idle<spaces.length){
    const space=spaces[next%spaces.length];next=(next+1)%spaces.length;
    const rank=BigInt(ranks[space.key]||0);
    if(rank>=space.total){idle++;continue}
    idle=0;ranks[space.key]=String(rank+1n);examined++;
    const legs=space.at(rank),key=comboExclusionKey(legs);
    if(known.has(key)||seen.has(key)||excluded.has(key)||comboGroupRejection(legs)||!comboCollection([space.collection],legs))continue;
    if(legs.some((a,i)=>excluded.has(comboExclusionKey([a]))||legs.slice(i+1).some(b=>excluded.has(comboExclusionKey([a,b])))))continue;
    seen.add(key);selected.push({legs,collection:space.collection,groupKey:key});
  }
  return {plans:selected,cursor:{ranks,next},examined,
    exhausted:spaces.every(s=>BigInt(ranks[s.key]||0)>=s.total),
    coverage:spaces.map(s=>({collection:s.collection.collection_ticker,size:s.size,total:String(s.total),visited:ranks[s.key]||'0'}))};
}
// Compatibility selector for callers without a persisted cursor. The live
// engine uses nextComboBatch and commits its cursor together with queued work.
export function plannedComboGroups(collections,candidates,maxPlans=COMBO_RFQ_PLANS,rotation=0,excluded=new Set(),requiredTicker=null){
  let spaces=comboSpaces(collections,candidates,requiredTicker);
  const sizes=[...new Set(spaces.map(s=>s.size))],offset=Math.max(0,Math.trunc(rotation));
  if(sizes.length>maxPlans){
    const middle=sizes.slice(1,-1),slots=Math.max(0,maxPlans-2);
    const chosen=new Set([sizes[0],sizes.at(-1),...Array.from({length:slots},(_,i)=>middle[(offset*slots+i)%middle.length])]);
    spaces=spaces.filter(s=>chosen.has(s.size));
  }
  const ranks=Object.fromEntries(spaces.map(s=>[s.key,String(BigInt(offset)*2n%s.total)]));
  // Hide unselected sizes by marking them complete for this compatibility pass.
  for(const s of comboSpaces(collections,candidates,requiredTicker))if(!(s.key in ranks))ranks[s.key]=String(s.total);
  return nextComboBatch(collections,candidates,{cursor:{ranks,next:0},maxPlans,excluded,requiredTicker}).plans;
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
export function comboLegs(legs){return legs.map(c=>({game_id:c.milestone.id,event_ticker:c.event.event_ticker,market_ticker:c.market.ticker,strategy:c.signal.strategy,title:c.state.title,sport:c.state.sport,home_name:c.state.homeName,away_name:c.state.awayName,kalshiOnly:c.signal.kalshiOnly===true,externallyVerified:c.signal.externallyVerified===true}));}

