// Describe the *observed* result of a prioritized OVER recheck, rather than
// claiming a quoted ask itself was an executable, permitted order.
export function overRetryExplanation({stage='fresh_score',outcome='skipped',detail=null}={}){
  if(outcome==='filled')return 'Order submitted';
  const reason=typeof detail==='string'?detail.trim():'';
  if(reason)return reason.slice(0,180);
  if(outcome==='error')return 'Over recheck could not complete; market or verification service unavailable';
  switch(stage){
    case 'fresh_score':return 'Fresh live score or linked OVER contract not available for recheck';
    case 'score_verification':return 'Independent score, exact market or required removable OVER scoring cushion not confirmed';
    case 'live_contract_and_orderbook':return 'No executable YES seller in the live orderbook or contract changed';
    case 'score_and_cash_recheck':return 'Current score, available cash or net profit after fees did not qualify';
    case 'submission':return 'Order submission or fill could not be confirmed';
    default:return 'Required independent score and executable trade conditions not confirmed';
  }
}