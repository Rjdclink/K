// Old order-harness tests inject minimal external evidence (eventId only).
// Their purpose is scheduling/fees/authorization, not provider parsing.
// The real checkpoint's source identity and score vetoes are tested with SQL
// and full ESPN/FOX score fixtures in no_final_checkpoint.test.mjs.
const stored=new WeakMap();
export const noFinalCheckpoint=async({game,market,first,verify})=>{
 if(!first)return {ok:false,attempted:false,reason:'Missing first score proof'};
 const signature=JSON.stringify([market?.ticker,game?.home,game?.away,game?.period,
  first?.first_at]);
 if(stored.get(first)?.signature===signature){
  return {...stored.get(first).result,newCheck:false};
 }
 const proof=await verify();
 if(!proof)return {ok:false,attempted:true,reason:'Independent fixture and score unavailable'};
 const result={ok:true,at:Date.now(),proof,newCheck:true};
 stored.set(first,{signature,result});
 return result;
};
// Legacy scanner harnesses stub ESPN readings with eventId but omit scores;
// their order and timing tests still check same-event identity. Production
// pairing checks both source and actual home/away scores separately.
export const pairedExternalMatch=(first,second)=>Boolean(first?.eventId&&second?.eventId&&
  first.source===second.source&&String(first.eventId)===String(second.eventId));