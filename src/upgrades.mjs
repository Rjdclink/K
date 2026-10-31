// The exchange position, not the original order, is the source of current exposure.
export function remainingVerifiedOverCents(position,bankroll,fraction=.10){
  const held=Number(position?.position_fp);
  const exposure=Number(position?.market_exposure_dollars);
  const fees=Number(position?.fees_paid_dollars);
  if(!Number.isFinite(held)||held<=0||position?.market_exposure_dollars==null||
    position?.fees_paid_dollars==null||!Number.isFinite(exposure)||exposure<0||
    !Number.isFinite(fees)||fees<0||!Number.isFinite(bankroll)||bankroll<=0||![.10,.35].includes(fraction))return 0;
  return Math.max(0,Math.floor(bankroll*fraction)-Math.ceil(exposure*100)-Math.ceil(fees*100));
}
export function upgradeEligible(fill,position,candidate){
  return Boolean(fill&&position&&candidate&&fill.status==='filled'&&
    fill.strategy==='over'&&!fill.combo_legs&&
    fill.market_ticker===candidate.market?.ticker&&fill.event_ticker===candidate.event?.event_ticker&&
    fill.game_id===candidate.milestone?.id&&candidate.signal?.strategy==='over'&&
    (candidate.signal.fraction===.35||candidate.signal.fraction===.10&&/Kalshi-only/i.test(fill.reason||''))&&Number(position.position_fp)>0&&
    position.ticker===fill.market_ticker);
}
