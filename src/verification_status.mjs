export function verificationStatus(record){
  if(record.passed)return record.mode==='kalshi_only_crossed_over'?
    'Two Kalshi score checks passed; final quote pending':'External score matched; fresh Kalshi read and final quote pending';
  if(record.verification_issue)return record.verification_issue;
  if(record.independent_unavailable===true||record.independent_unavailable==='true')
    return 'No matching external live score; waiting for verification';
  if(record.independent_unavailable===false||record.independent_unavailable==='false')
    return 'External score or match state disagrees with Kalshi';
  return 'Score verification did not pass';
}
