// Strategy fractions remain entry/proof metadata rather than bankroll ceilings.
// Every qualified automatic trade has a fee-inclusive 100% bankroll ceiling.
// Verification, cash, liquidity and profit safeguards remain separate.
export const ORDINARY_ENTRY_MAX_FRACTION=1;
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
 return Math.floor(bankroll*automaticEntryFraction(entry));
}