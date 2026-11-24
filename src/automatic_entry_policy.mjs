// Strategy fractions remain entry/proof metadata rather than bankroll ceilings.
// Every qualified automatic trade has a fee-inclusive 100% bankroll ceiling.
// Verification, cash, liquidity and profit safeguards remain separate.
export const ORDINARY_ENTRY_MAX_FRACTION=1;
export const MAX_TRADE_CENTS=20000;

// A sizing rule, not a win-probability estimate. More independent scoring
// swings of protection raise the stake. More time and a higher price lower it.
export function tradeBudgetCents({strategy,game,market,price}={},bankroll){
 const ceiling=Math.min(MAX_TRADE_CENTS,Math.floor(bankroll));
 if(!Number.isFinite(ceiling)||ceiling<=0)return 0;
 const soccer=game?.type?.startsWith('soccer_'),hockey=game?.type?.startsWith('hockey_'),
   football=game?.type?.startsWith('football_');
 const series=String(market?.event_ticker||'').split('-')[0];
 const totalNo=strategy==='no'&&/TOTAL$/.test(series)&&
   !/(?:TEAM|[1-4][HQPS]|HALF|PERIOD)TOTAL$/.test(series);
 if(!(soccer||hockey||football)||(!totalNo&&strategy!=='lead'))return ceiling;
 const score=totalNo?game.independentEntry?.score:game.externalScore;
 if(!score||!score.eventId||score.gameId!==game.id||!Number.isInteger(score.home)||
   !Number.isInteger(score.away)||score.home<0||score.away<0)return 0;
 const rawGap=totalNo?Number(market.floor_strike)-score.home-score.away:Math.abs(score.home-score.away);
 const swings=rawGap/(football?8:1);
 const elapsed=Number.isFinite(score.elapsedMinute)?score.elapsedMinute:game.soccerMinute;
 // Soccer's regulation clock does not establish when stoppage will end.
 // Keep a five-minute allowance even when regulation time has expired.
 const seconds=soccer?Math.max(0,(90-elapsed)*60)+300:
   Number.isFinite(score.seconds)?score.seconds:game.remainingSeconds;
 if(!Number.isFinite(swings)||swings<=0||!Number.isFinite(seconds)||seconds<0||
   !Number.isFinite(price)||price<=0||price>=1)return 0;
 const weight=swings/(swings+price*(1+seconds/120));
 return Math.floor(ceiling*weight);
}
export function hasIndependentCushionedOverProof(game){
 const over=game?.overVerification,entry=game?.independentEntry;
 return Boolean(over&&entry&&
   game?.verificationId&&entry.verificationId===game.verificationId&&
   ['cushion','seller_cushion'].includes(over.route));
}
export function automaticEntryFraction({strategy,fraction,game}={}){
 const requested=Number(fraction);
 if(!Number.isFinite(requested)||requested<=0)return 0;
 // The signal's former tier no longer caps the order's fee-inclusive cost.
 return ORDINARY_ENTRY_MAX_FRACTION;
}
export function automaticEntryCapCents(entry,bankrollCents){
 const bankroll=Number(bankrollCents);
 if(!Number.isFinite(bankroll)||bankroll<=0)return 0;
 return Math.min(tradeBudgetCents(entry,bankroll),Math.floor(bankroll*automaticEntryFraction(entry)));
}