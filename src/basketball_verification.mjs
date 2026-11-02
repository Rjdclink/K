import {basketballCloseoutEntry,leadSignal} from './strategy.mjs';
import {overContractKey,sameSportsContract} from './over_verification.mjs';
export async function parallelBasketballVerification(game,market,{readQuote,verify,now=Date.now}){
  const [quote,decision]=await Promise.all([readQuote(),verify()]);
  const price=Number(quote?.yes_ask_dollars),size=Number(quote?.yes_ask_size_fp??quote?.yes_ask_size);
  if(!quote||!(price>0&&price<1&&size>0)||decision!==true||!sameSportsContract(market,quote)||
    overContractKey(game,market)!==overContractKey(game,quote)||!basketballCloseoutEntry(game)||!leadSignal(game,quote))return null;
  game.basketballVerification={contractKey:overContractKey(game,quote),verifiedAt:now()};
  return quote;
}
export function assertBasketballVerification(game,market,now=Date.now()){
  if(!game?.basketballVerification&&!basketballCloseoutEntry(game))return;
  const proof=game.basketballVerification,age=now-game.observedAt;
  if(!proof||proof.contractKey!==overContractKey(game,market)||now<proof.verifiedAt||now-proof.verifiedAt>10000||
    !Number.isFinite(age)||age<0||age>10000||!basketballCloseoutEntry(game)||
    !leadSignal(game,market)||game.remainingSeconds*1000<=age)
    throw Object.assign(Error('Basketball score or mandatory external verification expired before dispatch'),{code:'LOCAL_LEAD_SCORE_EXPIRED'});
}
