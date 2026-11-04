import {mentionTickerDay,mentionDay} from './mentions.mjs';
import {mentionRuleSources} from './mentions_rules_source.mjs';

export function cachedMentionBinding(row,now=Date.now()){
  const descriptor=row?.descriptor;
  if(!descriptor)return null;
  return descriptor.eventDate===mentionDay(now,descriptor.timezone||'America/New_York')?
    descriptor:null;
}

export async function publisherHasEventMedia(ruleSource,day,{fetcher=fetch}={}){
  let url;
  try{url=new URL(ruleSource?.url)}catch{return false}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
    url.hostname==='localhost'||/^(?:\d+\.){3}\d+$/.test(url.hostname)||
    /\.(?:local|internal|test|example)$/.test(url.hostname))return false;
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')||'')||
    Number(response.headers.get('content-length'))>1_000_000)return false;
  const html=await response.text();if(html.length>1_000_000)return false;
  const date=new Date(day+'T12:00:00Z');if(!Number.isFinite(date.getTime()))return false;
  const long=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
  const short=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
  for(const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)){
    if(!/(?:caption|transcript|\.vtt\b|\.srt\b)/i.test(match[0]))continue;
    const nearby=html.slice(Math.max(0,match.index-600),match.index+match[0].length+600)
      .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
    if(nearby.includes(long)||nearby.includes(short))return true;
  }
  return false;
}

// Claude locates a publisher link and proposes exact markers. The scanner
// subsequently fetches the rule-named page and caption/transcript itself;
// this response alone never becomes evidence for an order.
export async function proposeMentionBinding(event,contract,{env=process.env,fetcher=fetch,mediaReady=false,forceSearch=false}={}){
  const rules=mentionRuleSources(event),day=mentionTickerDay(event?.event_ticker);
  if(!env.ANTHROPIC_API_KEY||rules.length!==1||!day||!contract?.subject)return null;
  const ruleSource=rules[0],host=new URL(ruleSource.url).hostname;
  if(!mediaReady&&!forceSearch&&!await publisherHasEventMedia(ruleSource,day,{fetcher}))return null;
  const response=await fetcher('https://api.anthropic.com/v1/messages',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(12_000),
    headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,
      'anthropic-version':'2026-10-21'},
    body:JSON.stringify({model:'claude-haiku-5-5',max_tokens:900,
      tools:[{type:'web_search_20250305',name:'web_search',max_uses:1,allowed_domains:[host]},
        {type:'web_fetch_20250910',name:'web_fetch',max_uses:1,allowed_domains:[host]}],
      system:'Locate the exact published caption or transcript for this one event on the named publisher site. Prefer captions. The publisher page, not your answer, is the evidence. Return JSON only. If unavailable, return null. Never infer spoken words from a press release, event listing, or search snippet. Do not guess markers, speakers, or a call time.',
      messages:[{role:'user',content:JSON.stringify({eventTicker:event.event_ticker,eventTitle:event.title,
        eventDay:day,ruleSource,subject:contract.subject,task:'Find the exact official caption or transcript on the rule-named publisher host. Return {url or linkText,eventMarker,dateMarker,eventTimeMarker,scheduledAt,timezone,speakerMarkers,segments:[{start,end}]}. url must be a direct transcript or caption on that host; linkText must uniquely identify a link on the rule source page. Every marker must appear verbatim on the publisher page or caption/transcript, and each segment must start with its qualifying speaker label. If any required field is unknown, return null.'})}]})});
  if(!response.ok)return null;
  const payload=await response.json();
  if(payload.stop_reason==='pause_turn')return null;
  const raw=payload.content?.filter(part=>part.type==='text').map(part=>part.text).join('')||'';
  if(raw.length>7000)return null;
  let proposed;
  try{proposed=JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim())}catch{return null}
  if(!proposed||typeof proposed!=='object'||Array.isArray(proposed)||
    !['eventMarker','dateMarker','eventTimeMarker','scheduledAt','timezone'].every(key=>
      typeof proposed[key]==='string'&&proposed[key].length>2&&proposed[key].length<240)||
    !((typeof proposed.url==='string'&&proposed.url.length<1000)||
      (typeof proposed.linkText==='string'&&proposed.linkText.length>2&&proposed.linkText.length<240))||
    !Array.isArray(proposed.speakerMarkers)||proposed.speakerMarkers.length<1||
    proposed.speakerMarkers.length>12||proposed.speakerMarkers.some(x=>typeof x!=='string'||x.length<2||x.length>120)||
    !Array.isArray(proposed.segments)||proposed.segments.length<1||proposed.segments.length>30||
    proposed.segments.some(x=>typeof x?.start!=='string'||typeof x?.end!=='string'||
      x.start.length<2||x.end.length<2||x.start.length>240||x.end.length>240)||
    !Number.isFinite(Date.parse(proposed.scheduledAt))||
    mentionDay(proposed.scheduledAt,proposed.timezone)!==day)return null;
  if(proposed.url){let direct;
    try{direct=new URL(proposed.url)}catch{return null}
    if(direct.protocol!=='https:'||direct.hostname!==host||direct.username||direct.password||
      direct.port||direct.hash)return null;
  }
  return {eventTicker:event.event_ticker,ruleSourceUrl:ruleSource.url,eventDate:day,
    ...(proposed.url?{url:proposed.url}:{discoveryUrl:ruleSource.url,linkText:proposed.linkText}),
    subject:contract.subject,
    eventMarker:proposed.eventMarker,dateMarker:proposed.dateMarker,
    eventTimeMarker:proposed.eventTimeMarker,scheduledAt:proposed.scheduledAt,
    timezone:proposed.timezone,speakerMarkers:proposed.speakerMarkers,
    segments:proposed.segments};
}
