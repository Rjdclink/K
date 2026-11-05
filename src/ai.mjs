// Exchange history and fresh-entry checks control the one bounded retry.
export async function reviewMiss(){
  return {available:false,retry:true,reason:'Exchange history has no original order; bounded retry'};
}
