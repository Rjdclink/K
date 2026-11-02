const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
export function sportsContractKey(game,market){
  return JSON.stringify(sorted({game:game.id,ticker:market.ticker,event:market.event_ticker,
    rules:market.rules_primary,secondary:market.rules_secondary,strike:market.floor_strike,
    cap:market.cap_strike,strikeType:market.strike_type,close:market.close_time,custom:market.custom_strike||{},collection:market.mve_collection_ticker,legs:market.mve_selected_legs}));
}
export function rememberIndependentEntry(game,market,verificationId,requestedAt,overValue){
  game.independentEntry={contractKey:sportsContractKey(game,market),verificationId,requestedAt,overValue};
}
export function independentEntryValid(game,market,now=Date.now()){
  const proof=game?.independentEntry;
  return Boolean(proof&&market&&proof.verificationId===game.verificationId&&
    proof.contractKey===sportsContractKey(game,market)&&Number.isFinite(proof.requestedAt)&&
    now>=proof.requestedAt&&now-proof.requestedAt<=30000);
}
export function assertExternalPurchase(path,method,body,entries,now=Date.now()){
  const route=path.split('?')[0];
  const single=method==='POST'&&/^\/portfolio\/(?:events\/)?orders(?:\/batched)?$/.test(route)&&
    (body?.side==='bid'||body?.action==='buy'||body?.orders?.some(order=>order.side==='bid'||order.action==='buy'));
  const rfq=['PUT','POST'].includes(method)&&/^\/communications\/.*\/(?:accept|confirm)$/.test(route);
  if(!single&&!rfq)return;
  if(!Array.isArray(entries)||!entries.length||entries.some(entry=>!independentEntryValid(entry.game,entry.market,now))||
    single&&(entries.length!==1||body.ticker!==entries[0].market.ticker))
    throw Object.assign(Error('Fresh independent external verification is mandatory before a purchase'),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
}
