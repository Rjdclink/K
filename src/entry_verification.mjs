import {assertNewEntryAllowed} from './entry_exclusions.mjs';
import {assertFinalFiveEntry} from './final_five_entry.mjs';
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
export function sportsContractKey(game,market){
  return JSON.stringify(sorted({game:game.id,ticker:market.ticker,event:market.event_ticker,
    rules:market.rules_primary,secondary:market.rules_secondary,strike:market.floor_strike,
    cap:market.cap_strike,strikeType:market.strike_type,close:market.close_time,custom:market.custom_strike||{},collection:market.mve_collection_ticker,legs:market.mve_selected_legs}));
}
export function rememberIndependentEntry(game,market,verificationId,requestedAt,overValue,score){
  // A newly stored proof cannot make an older independently sourced score new.
  const sourceAt=Number(game.externalScore?.checkedAt);
  const proofAt=Number.isFinite(sourceAt)&&sourceAt>0?Math.min(sourceAt,requestedAt):requestedAt;
  // NHL and soccer NO strategies can carry a separately validated, exact
  // external fixture score even when their game state still shows Kalshi's score.
  const scored=score&&['ESPN','FOX Sports','BBC Sport','NHL','NFL'].includes(score.source)&&
    String(score.eventId||'').trim()&&Number.isInteger(score.home)&&score.home>=0&&
    Number.isInteger(score.away)&&score.away>=0;
  game.independentEntry={contractKey:sportsContractKey(game,market),verificationId,
    requestedAt:proofAt,overValue,
    ...(scored?{score:{source:score.source,eventId:String(score.eventId),
      gameId:game.id,home:score.home,away:score.away,checkedAt:proofAt,
      period:score.period,
      clockSource:score.clockSource||score.source,
      ...(Number.isFinite(score.elapsedMinute)?{elapsedMinute:score.elapsedMinute}:{}),
      ...(Number.isFinite(score.seconds)?{seconds:score.seconds}:{})}}:{})};
}
export function independentEntryValid(game,market,now=Date.now()){
  const proof=game?.independentEntry;
  return Boolean(proof&&market&&proof.verificationId===game.verificationId&&
    proof.contractKey===sportsContractKey(game,market)&&Number.isFinite(proof.requestedAt)&&
    now>=proof.requestedAt&&now-proof.requestedAt<=15000);
}
export function assertExternalPurchase(path,method,body,entries,now=Date.now()){
  const route=path.split('?')[0];
  // Exchange-enforced reduce-only orders close holdings, including a YES
  // bid that reduces an existing short NO contract; they open no position.
  // All non-reduce-only buy/NO-ask paths still require independent proof and
  // the final-five game clock when the sport is soccer or hockey.
  const opening=order=>order?.reduce_only!==true&&
    (order?.side==='bid'||order?.side==='ask'||order?.action==='buy');
  const single=method==='POST'&&/^\/portfolio\/(?:events\/)?orders(?:\/batched)?$/.test(route)&&
    (opening(body)||body?.orders?.some(opening));
  const rfq=['PUT','POST'].includes(method)&&/^\/communications\/.*\/(?:accept|confirm)$/.test(route);
  if(!single&&!rfq)return;
  if(!Array.isArray(entries)||!entries.length||entries.some(entry=>!independentEntryValid(entry.game,entry.market,now))||
    single&&(entries.length!==1||body.ticker!==entries[0].market.ticker))
    throw Object.assign(Error('Fresh independent external verification is mandatory before a purchase'),{code:'LOCAL_EXTERNAL_VERIFICATION_REQUIRED'});
  for(const {game,market} of entries)assertNewEntryAllowed(game,market);
  assertFinalFiveEntry(entries,{side:single?body.side:null});
}
