import {createHash} from 'node:crypto';

export const MENTION_DELAY_MS=45_000;
export const MENTION_MAX_PRICE=0.40;
export const MENTION_MAX_FRACTION=0.15;

const clean=value=>String(value||'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").trim();
const label=value=>clean(value).replace(/\s+/g,' ').toLowerCase();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const day=(at,zone)=>{
  const date=new Date(at);
  if(!Number.isFinite(date.getTime()))return null;
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(date).filter(x=>['year','month','day'].includes(x.type))
    .reduce((out,x)=>({...out,[x.type]:x.value}),{});
  }catch{return null}
};
export function mentionDay(at,zone='America/New_York'){
  const parts=day(at,zone);
  return parts?`${parts.year}-${parts.month}-${parts.day}`:null;
}
export function mentionTickerDay(ticker){
  const match=String(ticker||'').match(/-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/i);
  if(!match)return null;
  const month='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').indexOf(match[2].toUpperCase());
  const date=new Date(Date.UTC(2000+Number(match[1]),month,Number(match[3])));
  return date.getUTCMonth()===month&&date.getUTCDate()===Number(match[3])?date.toISOString().slice(0,10):null;
}
export function mentionEventTime(event,market,descriptor){
  const start=Date.parse(descriptor?.scheduledAt||''),zone=descriptor?.timezone;
  if(!Number.isFinite(start)||!zone||mentionDay(start,zone)!==descriptor.eventDate)return false;
  const listed=Date.parse(event?.strike_date||'');
  const text=[event?.title,event?.sub_title,market?.rules_primary,market?.rules_secondary].join(' ');
  return Number.isFinite(listed)?Math.abs(listed-start)<=60_000:
    Boolean(descriptor.contractTimeMarker&&text.includes(descriptor.contractTimeMarker));
}

export function mentionContract(event,market,series){
  const categories=[series?.category,...(series?.categories||[]),...(series?.tags||[])].map(label);
  if(!categories.includes('mentions')||!['open','active'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result))||
    !market.ticker||market.event_ticker!==event?.event_ticker)return null;
  const rule=clean(market.rules_primary),secondary=clean(market.rules_secondary);
  const target=clean(market.yes_sub_title||market.subtitle);
  if(!rule||!target||!/^resolves yes if\b/i.test(rule)||
    !/\b(?:says?|said|states?|spoken|stated|mentions?)\b/i.test(rule)||
    !rule.toLowerCase().includes(target.replace(/\s*\(\d+\+\s*times?\)\s*$/i,'').toLowerCase()))return null;
  const count=target.match(/\s*\((\d+)\+\s*times?\)\s*$/i);
  if(/\(\s*\d+\+?\s*times?\s*\)/i.test(target)&&!count)return null;
  const minimum=count?Number(count[1]):1;
  if(!Number.isSafeInteger(minimum)||minimum<1||minimum>100)return null;
  const phrase=target.replace(/\s*\(\d+\+\s*times?\)\s*$/i,'').trim();
  const alternatives=phrase.split(/\s*\/\s*/).map(label);
  if(!alternatives.length||alternatives.some(x=>!x||!/^[\p{L}\p{N}' -]+$/u.test(x)))return null;
  // A narrow parser avoids inventing settlement rules for special strikes.
  if(/event does not qualify|event does not occur/i.test(phrase)||
    /\b(?:and|or)\b/i.test(secondary)&&!/plural|possessive/i.test(secondary))return null;
  const escaped=escape(phrase).replace(/\s+/g,'\\s+');
  const forward=rule.match(new RegExp('^resolves yes if (.+?)\\s+(?:says?|mentions?)\\s+'+escaped+'\\b','i'));
  const reverse=rule.match(new RegExp('^resolves yes if '+escaped+'\\s+is\\s+(?:said|stated|spoken)\\s+by\\s+(.+?)\\s+(?:during|at|before|as part of)\\b','i'));
  const subject=label(forward?.[1]||reverse?.[1]);
  if(!subject)return null;
  return {ticker:market.ticker,eventTicker:event.event_ticker,rule,secondary,
    close:market.close_time,alternatives,minimum,subject,
    pluralAllowed:/\bplural\b/i.test(rule+' '+secondary),
    possessiveAllowed:/\bpossessive\b/i.test(rule+' '+secondary),
    key:JSON.stringify([market.ticker,event.event_ticker,rule,secondary,market.close_time,phrase,minimum])};
}

function forms(word,contract){
  const variants=new Set([word]);
  const irregular={child:'children',person:'people',woman:'women',man:'men',mouse:'mice',goose:'geese',foot:'feet',tooth:'teeth'};
  if(contract.pluralAllowed&&irregular[word])variants.add(irregular[word]);
  else if(contract.pluralAllowed&&(!word.endsWith('s')||/(?:ss|us)$/.test(word))){
    if(/[^aeiou]y$/.test(word))variants.add(word.slice(0,-1)+'ies');
    else if(/(?:ch|sh|x|z|ss|us)$/.test(word))variants.add(word+'es');
    else variants.add(word+'s');
  }
  if(contract.possessiveAllowed)for(const value of [...variants])variants.add(value.endsWith('s')?value+"'":value+"'s");
  return [...variants];
}
export function countMentionOccurrences(text,contract){
  if(typeof text!=='string'||text.length>2_000_000||!contract?.alternatives?.length)return 0;
  const content=clean(text).toLowerCase(),spans=[];
  for(const alternative of contract.alternatives){
    const words=alternative.split(/[ -]+/).filter(Boolean);
    if(!words.length)continue;
    const final=words.pop();
    const prefixes=words.map(escape).join('[ -]+');
    const pattern=`(?<![\\p{L}\\p{N}_])${prefixes?prefixes+'[ -]+':''}(?:${forms(final,contract).map(escape).join('|')})(?![\\p{L}\\p{N}_])`;
    const regex=new RegExp(pattern,'giu');
    for(const match of content.matchAll(regex))spans.push([match.index,match.index+match[0].length]);
  }
  spans.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
  let count=0,end=-1;
  for(const [start,stop] of spans)if(start>=end){count++;end=stop}
  return count;
}

export function mentionObservation(contract,source,{now=Date.now(),side}={}){
  const at=Number(now),zone=source?.timezone||'America/New_York';
  if(!Number.isFinite(at)||!['yes','no'].includes(side)||!contract||
    !/^https:\/\//i.test(source?.url||'')||!source?.official||
    !/^\d{4}-\d{2}-\d{2}$/.test(source?.eventDate||'')||
    source.eventDate!==mentionDay(at,zone)||source.eventTicker!==contract.eventTicker||
    !Number.isFinite(Date.parse(source.scheduledAt||''))||at<Date.parse(source.scheduledAt)||
    mentionDay(source.scheduledAt,zone)!==source.eventDate||
    typeof source.text!=='string'||!source.text.trim()||source.text.length>2_000_000||
    !source.speakerConfirmed||!source.eventConfirmed||label(source.subject)!==contract.subject)return null;
  const count=countMentionOccurrences(source.text,contract),positive=count>=contract.minimum;
  if(side==='yes'&&!positive)return null;
  if(side==='no'&&(positive||!source.complete||!source.noCoverageConfirmed||
    !Number.isFinite(Date.parse(source.endedAt||''))||
    Date.parse(source.endedAt)>at||Date.parse(source.endedAt)<Date.parse(source.scheduledAt)))return null;
  return {ticker:contract.ticker,side,eventDate:source.eventDate,eventStart:source.scheduledAt,
    eventTicker:contract.eventTicker,contractKey:contract.key,
    sourceUrl:source.url,sourceId:source.id||source.url,contentHash:createHash('sha256').update(source.text).digest('hex'),
    count,minimum:contract.minimum,checkedAt:at};
}

export function pairedMentionProof(first,second,now=Date.now()){
  return Boolean(first&&second&&first.side===second.side&&first.eventTicker===second.eventTicker&&
    first.eventDate===second.eventDate&&first.eventStart===second.eventStart&&
    first.contractKey===second.contractKey&&
    first.sourceUrl===second.sourceUrl&&first.sourceId===second.sourceId&&
    first.contentHash===second.contentHash&&second.checkedAt-first.checkedAt>=MENTION_DELAY_MS&&
    second.checkedAt-first.checkedAt<=30*60_000&&
    second.checkedAt<=now&&now-second.checkedAt<=30_000);
}

export function mentionEntryPrice(price){
  const value=Number(price);
  return Number.isFinite(value)&&value>0&&Math.round(value*10_000)<=4_000&&value<=MENTION_MAX_PRICE;
}
export function remainingMentionCents(bankroll,heldCents,pendingCents=0){
  if(![bankroll,heldCents,pendingCents].every(Number.isFinite)||bankroll<=0||heldCents<0||pendingCents<0)return 0;
  return Math.max(0,Math.floor(bankroll*MENTION_MAX_FRACTION)-heldCents-pendingCents);
}
