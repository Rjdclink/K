// Kalshi's event settlement_sources field is the source named by the contract.
// Keep the exact publisher URL; a search result or a model's suggested URL
// cannot silently replace it.
export function mentionRuleSources(event){
  const sources=Array.isArray(event?.settlement_sources)?event.settlement_sources:[];
  return sources.flatMap(source=>{
    if(typeof source?.name!=='string'||!source.name.trim())return [];
    let url;
    try{url=new URL(source.url)}catch{return []}
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return [];
    return [{name:source.name.trim(),url:url.href}];
  });
}

export function boundMentionSource(event,descriptor){
  const published=mentionRuleSources(event);
  return Boolean(descriptor&&typeof descriptor.ruleSourceUrl==='string'&&
    published.some(source=>source.url===descriptor.ruleSourceUrl));
}
