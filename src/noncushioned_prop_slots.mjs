// Count only open non-cushioned player-prop entries, never completed fills,
// inactive positions, cushioned OVERs, or variable-value player markets.
// Pending orders reserve their slot until exchange reconciliation resolves them.
export const MAX_UNCUSHIONED_PLAYER_PROPS=5;
export const NONCUSHIONED_PLAYER_TAG='Non-cushioned player prop';
export function countablePlayerMarketTicker(ticker){
 const series=String(ticker||'').split('-')[0];
 return /^KX[A-Z0-9]+(?:REB|AST|3PT|STL|BLK|GOALS|SAVES|SOG|HITS|HR)$/.test(series);
}

export function openNoncushionedPlayerTickers(positions,attempts,settledTickers=new Set()){
 if(!Array.isArray(positions)||!Array.isArray(attempts)||!(settledTickers instanceof Set))return null;
 const result=new Set();
 for(const row of attempts){
  if(!String(row?.reason||'').includes(NONCUSHIONED_PLAYER_TAG)||!row.market_ticker)continue;
  if(['reserved','retrying','check_order','combo_pending'].includes(row.status)||
    row.status==='filled'&&!settledTickers.has(row.market_ticker))result.add(row.market_ticker);
 }
 // A manually opened player market has no bot attempt. Treat an unclassified
 // countable player-prop holding conservatively as non-cushioned. A verified
 // bot cushion does not consume one of the five restricted slots.
 for(const position of positions){
  const ticker=String(position?.ticker||'');
  if(!countablePlayerMarketTicker(ticker)||settledTickers.has(ticker)||
    !(Number(position?.position_fp??position?.position)>0))continue;
  const records=attempts.filter(a=>a.market_ticker===ticker);
  const cushioned=records.some(a=>/still crossed after removing|verified cushioned OVER/i.test(String(a.reason||'')));
  if(!cushioned||records.some(a=>String(a.reason||'').includes(NONCUSHIONED_PLAYER_TAG)))
   result.add(ticker);
 }
 return result;
}
export function mayOpenNoncushionedPlayerProp(positions,attempts,newTicker,settledTickers=new Set()){
 const open=openNoncushionedPlayerTickers(positions,attempts,settledTickers);
 return open!==null&&newTicker&&!open.has(newTicker)&&open.size<MAX_UNCUSHIONED_PLAYER_PROPS;
}
