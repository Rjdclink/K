// HTTP representation freshness, distinct from the game's scheduled kickoff
// and from how recently Kalshi or our server refreshed its own display.
export const SCORE_FEED_MAX_AGE_MS=15000;
export function scoreFeedAgeMs(response,now=Date.now()){
  const headers=response?.headers;
  if(!headers?.get)return 0; // Injected test doubles may omit HTTP headers.
  const rawAge=headers.get('age'),rawDate=headers.get('date');
  let age=0;
  if(rawAge!=null){
    if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(rawAge)))return null;
    age=Number(rawAge)*1000;
  }
  if(rawDate!=null){
    const origin=Date.parse(String(rawDate));
    if(!Number.isFinite(origin)||origin>now+5000)return null;
    age=Math.max(age,Math.max(0,now-origin));
  }
  return Number.isFinite(age)&&age>=0&&age<=SCORE_FEED_MAX_AGE_MS?age:null;
}
