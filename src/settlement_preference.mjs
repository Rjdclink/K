// A tie resolving to $0.50 is not a refund for a YES bought near $1.
// Only treat an explicit return of both purchase price and fees as protection.
export function tieRefundPreference(market){
  const rules=`${market?.rules_primary||''} ${market?.rules_secondary||''}`;
  const clause=rules.split(/[.!?\n]/).find(part=>/\b(tie|draw)\b/i.test(part)&&/\brefund(?:ed)?\b/i.test(part));
  return Boolean(clause&&/(?:purchase price|amount paid|original cost)/i.test(clause)&&/(?:fees? (?:are|will be|is) refunded|refund(?:ed)?[^.]*fees?)/i.test(clause));
}
