export function verificationStatus(record){
  if(record.passed&&record.mode==='seller_backed_cushioned_over')return 'Cushioned over; live seller checked; final quote pending';
  if(record.passed&&record.mode==='independent_timed_over')return 'Both external checks and paired Kalshi check passed; final quote pending';
  if(record.passed)return record.mode==='kalshi_only_crossed_over'?
    'Two Kalshi score checks passed; final quote pending':'External score matched; fresh Kalshi read and final quote pending';
  if(record.verification_issue)return record.verification_issue;
  if(record.independent_unavailable===true||record.independent_unavailable==='true')
    return 'No matching external live score; entry blocked';
  if(record.independent_unavailable===false||record.independent_unavailable==='false')
    return 'External score or match state disagrees with Kalshi';
  return 'Score verification did not pass';
}
