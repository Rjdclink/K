// The dashboard shows one card item per confirmed attempt with a still-open
// Kalshi position. Recent pending attempts reserve slots during parallel buys.
export function filledOrderGateCount(positions,attempts,currentTicker){
  const open=new Set((positions.market_positions||[])
    .filter(p=>Number(p.position_fp??p.position??0)!==0).map(p=>p.ticker));
  const counted=new Set(attempts.filter(r=>r.status==='filled'&&open.has(r.market_ticker))
    .map(r=>r.market_ticker));
  for(const row of attempts)if(row.market_ticker!==currentTicker&&
    ['reserved','check_order','retrying','combo_pending'].includes(row.status)&&
    !open.has(row.market_ticker))counted.add(row.market_ticker);
  return counted.size;
}
