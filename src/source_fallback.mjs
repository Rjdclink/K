// A verified disagreement is a veto (false). Unavailability alone is null.
// FOX must not be contacted before an unavailable ESPN result is retried once.
export async function espnRetryThenFox({espn,fox}){
  if(typeof espn!=='function')return null;
  for(let attempt=0;attempt<2;attempt++){
    let result=null;
    try{result=await espn()}catch{}
    if(result!==null&&result!==undefined)return result;
  }
  if(typeof fox!=='function')return null;
  try{return (await fox())??null}catch{return null}
}