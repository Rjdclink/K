// Count only open non-cushioned player-prop entries, never completed fills,
// inactive positions, cushioned OVERs, or variable-value player markets.
// Pending orders reserve their slot until exchange reconciliation resolves them.
export const MAX_UNCUSHIONED_PLAYER_PROPS=5;
export const NONCUSHIONED_PLAYER_TAG='Non-cushioned player prop';
export function openNoncushionedPlayerTickers(positions,attempts,settledTickers=new Set()){
 if(!Array.isArray(positions)||!Array.isArray(attempts)||!(settledTickers instanceof Set))return null;
 const result=new Set();
 for(const row of attempts){
  if(!String(row?.reason||'').includes(NONCUSHIONED_PLAYER_TAG)||!row.market_ticker)continue;
  if(['reserved','retrying','check_order','combo_pending'].includes(row.status)||
    row.status==='filled'&&!settledTickers.has(row.market_ticker))result.add(row.market_ticker);
 }
 return result;
}
export function mayOpenNoncushionedPlayerProp(positions,attempts,newTicker,settledTickers=new Set()){
 const open=openNoncushionedPlayerTickers(positions,attempts,settledTickers);
 return open!==null&&newTicker&&!open.has(newTicker)&&open.size<MAX_UNCUSHIONED_PLAYER_PROPS;
}
