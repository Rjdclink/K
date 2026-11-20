// Existing scanner behavior tests isolate source functions into a vm. The
// new thirty-second retirement policy is tested separately with fake SQL and
// real boundary-time assertions; legacy order tests retain executable asks.
export const NO_ASK_RETIRED='No executable ask after 30 seconds; candidate skipped';
export const waitingOnAsk=()=> 'No executable ask; waiting 30s before skip';
export const noAskKey=c=>String(c.market?.ticker||c.ticker)+'\0'+String(c.state?.id||c.game?.id||c.game_id||c.milestone?.id);
export const noAskTimeout={
 retired:async()=>new Set(),missing:async()=>new Map(),available:async()=>{},
 isRetired:async()=>false,claimRecovery:async()=>false,observeMissing:async()=>({retired:false,elapsedMs:0})
};