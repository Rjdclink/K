import {reviewExternalAmbiguity} from './ai.mjs';

// Each mapping identifies an exact official transcript, not a search result or
// an agency home page. An unmapped event has no external evidence.
export function officialMentionSources(raw=process.env.MENTION_OFFICIAL_SOURCES){
  if(!raw)return new Map();
  const items=JSON.parse(raw);
  if(!Array.isArray(items))throw Error('MENTION_OFFICIAL_SOURCES must be an array');
  const entries=new Map();
  for(const item of items){
    if(typeof item?.eventTicker!=='string'||!/^[-A-Z0-9]{5,100}$/.test(item.eventTicker)||entries.has(item.eventTicker))
      throw Error('Duplicate or invalid mention event ticker');
    entries.set(item.eventTicker,item);
  }
  return entries;
}

function trustedUrl(value,extraHosts=[]){
  let url;
  try{url=new URL(value)}catch{return null}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
    host==='localhost'||/^(?:\d+\.){3}\d+$/.test(host)||
    /\.(?:local|localhost|internal|test|example)$/.test(host)||
    !(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.gov$/.test(host)||extraHosts.includes(host)))return null;
  return url;
}

const plain=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ')
  .replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ')
  .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/&quot;/gi,'"').replace(/&#(?:39|x27);/gi,"'")
  .replace(/\s+/g,' ').trim();

function oneSlice(text,start,end){
  if(!start||!end||start===end)return null;
  const begin=text.indexOf(start);
  if(begin<0||text.indexOf(start,begin+start.length)>=0)return null;
  const finish=text.indexOf(end,begin+start.length);
  if(finish<0||text.indexOf(end,finish+end.length)>=0)return null;
  const value=text.slice(begin+start.length,finish).trim();
  return value?{value,begin,finish:finish+end.length}:null;
}

export async function fetchOfficialMentionTranscript(descriptor,{fetcher=fetch,hosts=[],
  searchFetcher=fetch,searchKey=process.env.MENTION_BRAVE_SEARCH_KEY}={}){
  let url=trustedUrl(descriptor?.url||descriptor?.discoveryUrl,hosts);
  const markers=descriptor?.speakerMarkers||[descriptor?.speakerMarker];
  if((descriptor?.url||descriptor?.discoveryUrl)&&!url||
    !url&&!(descriptor?.searchQuery&&searchKey)||!/^\d{4}-\d{2}-\d{2}$/.test(descriptor?.eventDate||'')||
    !descriptor?.timezone||!Number.isFinite(Date.parse(descriptor.scheduledAt||''))||
    !Number.isFinite(Date.parse(descriptor.dateMarker||''))||
    new Date(descriptor.dateMarker).toISOString().slice(0,10)!==descriptor.eventDate||
    !Array.isArray(markers)||!markers.length||markers.some(x=>typeof x!=='string'||!x)||
    typeof descriptor?.subject!=='string'||!descriptor.subject.trim()||typeof descriptor?.eventMarker!=='string'||
    typeof descriptor?.dateMarker!=='string'||!Array.isArray(descriptor?.segments)||
    !descriptor.segments.length||descriptor.segments.length>30||
    descriptor.segments.some(part=>!markers.some(marker=>part?.start?.includes(marker))))return null;
  const read=async address=>{
    const res=await fetcher(address,{redirect:'error',headers:{accept:'text/plain, text/html;q=0.9','cache-control':'no-cache'},signal:AbortSignal.timeout(8000)});
    if(!res.ok||!/^(?:text\/plain|text\/html)(?:;|$)/i.test(res.headers.get('content-type')||'')||
      Number(res.headers.get('content-length'))>2_000_000)return null;
    if(!res.body?.getReader){const body=await res.text();return body.length<=2_000_000?body:null}
    const reader=res.body.getReader(),decoder=new TextDecoder();let body='',bytes=0;
    for(;;){const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();return null}
      body+=decoder.decode(value,{stream:true});
    }
    return body+decoder.decode();
  };
  if(!descriptor.url&&descriptor.discoveryUrl){
    if(!descriptor.discoveryUrl||!descriptor.linkText)return null;
    const listing=await read(url);
    if(!listing)return null;
    const links=[...listing.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
      .filter(match=>plain(match[2])===descriptor.linkText);
    if(links.length!==1)return null;
    const href=links[0][1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if(!href)return null;
    url=trustedUrl(new URL(href,url).href,hosts);
    if(!url)return null;
  }
  let addresses=url?[url]:[];
  if(!addresses.length){
    if(typeof descriptor.searchQuery!=='string'||descriptor.searchQuery.length>350)return null;
    const endpoint=new URL('https://api.search.brave.com/res/v1/web/search');
    endpoint.search=new URLSearchParams({q:descriptor.searchQuery+' transcript',count:'8',freshness:'pw'}).toString();
    const result=await searchFetcher(endpoint,{headers:{'x-subscription-token':searchKey},
      redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!result.ok||Number(result.headers.get('content-length'))>200_000)return null;
    const payload=await result.text();if(payload.length>200_000)return null;
    const data=JSON.parse(payload);
    addresses=[...new Set((data.web?.results||[]).slice(0,8).map(hit=>hit.url))]
      .map(hit=>trustedUrl(hit,hosts)).filter(Boolean).slice(0,5);
  }
  const matches=[];
  for(const address of addresses){
    let body;try{body=await read(address)}catch{continue}
    if(!body||body.length>2_000_000)continue;
    const text=plain(body);
    if(!text.includes(descriptor.eventMarker)||!text.includes(descriptor.dateMarker)||
      !markers.some(marker=>text.includes(marker)))continue;
    const segments=descriptor.segments.map(part=>oneSlice(text,part.start,part.end));
    if(segments.some(part=>!part))continue;
    const spans=[...segments].sort((a,b)=>a.begin-b.begin);
    if(spans.some((part,index)=>index>0&&part.begin<spans[index-1].finish))continue;
    const complete=Boolean(descriptor.completeMarker&&text.includes(descriptor.completeMarker)&&
      descriptor.endedAt&&Number.isFinite(Date.parse(descriptor.endedAt))&&
      text.lastIndexOf(descriptor.completeMarker)>=spans.at(-1).begin);
    matches.push({id:address.href,url:address.href,official:true,eventTicker:descriptor.eventTicker,eventDate:descriptor.eventDate,
      subject:descriptor.subject,contractTimeMarker:descriptor.contractTimeMarker,scheduledAt:descriptor.scheduledAt,
      timezone:descriptor.timezone||'America/New_York',speakerConfirmed:true,eventConfirmed:true,
      text:segments.map(part=>part.value).join('\n'),complete,
      noCoverageConfirmed:complete&&descriptor.noCoverageConfirmed===true,
      endedAt:complete?descriptor.endedAt:null});
  }
  if(matches.length>1&&process.env.ANTHROPIC_API_KEY){
    try{const review=await reviewExternalAmbiguity('mentions',{eventTicker:descriptor.eventTicker,
      eventDate:descriptor.eventDate,issue:'Multiple approved pages passed the exact transcript markers',
      pages:matches.map(item=>({url:item.url,excerpt:item.text.slice(0,120),length:item.text.length}))});
      console.warn('Mention source ambiguity:',descriptor.eventTicker,review.assessment,review.reason);
    }catch(e){console.warn('Mention source review deferred:',e.message)}
  }
  return matches.length===1?matches[0]:null;
}
