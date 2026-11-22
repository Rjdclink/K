// No automatic order may exceed fifteen percent of total bankroll unless it is a
// specifically verified, still-cushioned OVER. Caller-provided signal fractions
// never independently grant an exception.
export const ORDINARY_ENTRY_MAX_FRACTION=.15;
export function hasIndependentCushionedOverProof(game){
 const over=game?.overVerification,entry=game?.independentEntry;
 return Boolean(over&&entry&&
   game?.verificationId&&entry.verificationId===game.verificationId&&
   ['cushion','seller_cushion'].includes(over.route));
}
export function automaticEntryFraction({strategy,fraction,game}={}){
 const requested=Number(fraction);
 if(!Number.isFinite(requested)||requested<=0)return 0;
 return strategy==='over'&&hasIndependentCushionedOverProof(game)?
   requested:Math.min(ORDINARY_ENTRY_MAX_FRACTION,requested);
}
export function automaticEntryCapCents(entry,bankrollCents){
 const bankroll=Number(bankrollCents);
 if(!Number.isFinite(bankroll)||bankroll<=0)return 0;
 return Math.floor(bankroll*automaticEntryFraction(entry));
}