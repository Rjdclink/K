import test from 'node:test';
import assert from 'node:assert/strict';
import {mentionContract,mentionDay,mentionTickerDay,mentionEventTime,countMentionOccurrences,mentionObservation,pairedMentionProof,
  mentionEntryPrice,remainingMentionCents} from '../src/mentions.mjs';
import {scanMentionMarkets} from '../src/mentions_scanner.mjs';
import {fetchOfficialMentionTranscript} from '../src/mentions_source.mjs';

const event={event_ticker:'KXTESTMENTION-26NOV04',series_ticker:'KXTESTMENTION',
  title:'What will the speaker say today?',strike_date:'2026-11-04T17:30:00Z'};
const series={ticker:'KXTESTMENTION',categories:['Mentions']};
const market=(target,rule=`Resolves Yes if the Speaker says ${target} during the remarks. The exact word or a plural or possessive form counts.`)=>({
  ticker:'KXTESTMENTION-26NOV04-STRIKE',event_ticker:event.event_ticker,status:'active',yes_sub_title:target,
  rules_primary:rule,close_time:'2026-11-05T05:00:00Z',yes_ask_dollars:'0.4000',no_ask_dollars:'0.3999'});
const at=Date.parse('2026-11-04T18:00:00Z');
const source=(text,extra={})=>({id:'official',url:'https://www.whitehouse.gov/briefings/transcript',official:true,
  eventDate:'2026-11-04',eventTicker:event.event_ticker,timezone:'America/New_York',
  scheduledAt:'2026-11-04T17:30:00Z',
  speakerConfirmed:true,eventConfirmed:true,subject:'the Speaker',text,complete:true,noCoverageConfirmed:true,endedAt:'2026-11-04T17:45:00Z',...extra});

test('singular and allowed plural or possessive forms count as whole sayings, not substrings',()=>{
  const contract=mentionContract(event,market('Veteran'),series);
  assert.equal(countMentionOccurrences('veteran, veterans, veteran’s; veterans’ — veteranization and nonveteran.',contract),4);
  assert.equal(countMentionOccurrences('Veteran-veteran; Veterans the musical',contract),3);
});
test('a plural strike does not accept its singular form; distinct occurrences meet the stated minimum',()=>{
  const contract=mentionContract(event,market('Veterans (3+ times)'),series);
  assert.equal(contract.minimum,3);
  assert.equal(countMentionOccurrences('Veteran. Veterans! Veterans; veteran',contract),2);
  assert.equal(mentionObservation(contract,source('Veterans Veterans Veteran'),{now:at,side:'yes'}),null);
  assert.equal(mentionObservation(contract,source('Veterans Veterans Veterans'),{now:at,side:'yes'}).count,3);
});
test('earnings call language using “is said by” is a mention contract',()=>{
  assert.ok(mentionContract(event,market('Frosty','Resolves Yes if Frosty is said by any company representative during the live earnings call. Plural or possessive forms count.'),series));
});
test('news broadcast wording and a word containing “Times” are parsed without a false frequency threshold',()=>{
  const news=market('Iran / Iranian (3+ times)',
    'Resolves Yes if any host or reporter says Iran / Iranian (3+ times) as part of ABC World News Tonight originally scheduled for November 4, 2026. Plural forms count.');
  const c=mentionContract(event,news,series);
  assert.equal(c.subject,'any host or reporter');
  assert.equal(countMentionOccurrences('Iran, Iranian, Iran, Iranization',c),3);
  assert.equal(mentionContract(event,market('Times Square'),series).minimum,1);
  assert.equal(countMentionOccurrences('children, child',mentionContract(event,market('Child'),series)),2);
});
test('slash alternatives count without double-counting overlapping matches or word fragments',()=>{
  const c=mentionContract(event,market('Doge / Dogecoin (2+ times)'),series);
  assert.equal(countMentionOccurrences('Dogecoin, Doge, dogecoinage',c),2);
});
test('same-day evidence, finished NO events, and two checks at least 45 seconds apart',()=>{
  const contract=mentionContract(event,market('Iran (2+ times)'),series);
  assert.equal(mentionDay(at),'2026-11-04');
  assert.equal(mentionTickerDay('KXWENDYSMEM-26NOV05'),'2026-11-05');
  assert.equal(mentionObservation(contract,source('Iran Iran',{eventDate:'2026-11-03'}),{now:at,side:'yes'}),null);
  assert.equal(mentionObservation(contract,source('No word here',{complete:false}),{now:at,side:'no'}),null);
  assert.equal(mentionObservation(contract,source('No word here',{noCoverageConfirmed:false}),{now:at,side:'no'}),null);
  const first=mentionObservation(contract,source('No word here'),{now:at,side:'no'});
  const early=mentionObservation(contract,source('No word here'),{now:at+44_999,side:'no'});
  const second=mentionObservation(contract,source('No word here'),{now:at+45_000,side:'no'});
  assert.equal(pairedMentionProof(first,early,at+44_999),false);
  assert.equal(pairedMentionProof(first,second,at+45_000),true);
  assert.equal(pairedMentionProof(first,{...second,contentHash:'revised'},at+45_000),false);
  assert.equal(mentionObservation(contract,source('No word here',{endedAt:'2026-11-04T19:00:00Z'}),{now:at,side:'no'}),null);
});
test('40 cents is inclusive and the aggregate bankroll budget deducts held and pending costs',()=>{
  assert.equal(mentionEntryPrice('0.4000'),true);
  assert.equal(mentionEntryPrice('0.4001'),false);
  assert.equal(mentionEntryPrice('0'),false);
  assert.equal(remainingMentionCents(10000,900,150),450);
  assert.equal(remainingMentionCents(10000,1500,1),0);
});
test('official transcript extraction requires exact markers and rejects an unapproved host',async()=>{
  const descriptor={eventTicker:event.event_ticker,eventDate:'2026-11-04',url:'https://www.whitehouse.gov/remarks/test',
    timezone:'America/New_York',scheduledAt:'2026-11-04T17:30:00Z',
    subject:'the Speaker',speakerMarker:'Speaker:',eventMarker:'Today remarks',dateMarker:'November 4, 2026',
    segments:[{start:'Speaker:',end:'END REMARKS'}],completeMarker:'END REMARKS',endedAt:'2026-11-04T17:45:00Z'};
  const fetcher=async()=>({ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>'<article>November 4, 2026 Today remarks Speaker: Veterans Veterans END REMARKS</article>'});
  const good=await fetchOfficialMentionTranscript(descriptor,{fetcher});
  assert.equal(good.text,'Veterans Veterans');
  assert.equal(good.complete,true);
  assert.equal(await fetchOfficialMentionTranscript({...descriptor,url:'https://localhost/remarks'}, {fetcher}),null);
  const discovery={...descriptor,url:undefined,discoveryUrl:'https://www.whitehouse.gov/remarks/',linkText:'Full transcript'};
  const fetchListing=async address=>address.pathname==='/remarks/'?
    {ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>'<a href="/remarks/test">Full transcript</a>'}:fetcher();
  assert.equal((await fetchOfficialMentionTranscript(discovery,{fetcher:fetchListing})).url,descriptor.url);
  const absent=async()=>({ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>'<p>Not published</p>'});
  assert.equal(await fetchOfficialMentionTranscript(discovery,{fetcher:absent}),null);
});
test('scanner prioritizes mapped same-day events and skips unavailable transcripts without waiting',async()=>{
  const missingTicker='KXTESTMENTION-26NOV04-MISSING';
  const missing={...event,event_ticker:missingTicker,markets:[{...market('Iran'),ticker:missingTicker+'-IRAN',event_ticker:missingTicker,no_ask_dollars:'0.60'}]};
  const available={...event,markets:[market('Veterans (2+ times)')]};
  const mapping=new Map([[available.event_ticker,{eventTicker:available.event_ticker,eventDate:'2026-11-04',timezone:'America/New_York',scheduledAt:event.strike_date}],
    [missing.event_ticker,{eventTicker:missing.event_ticker,eventDate:'2026-11-04',timezone:'America/New_York',scheduledAt:event.strike_date}]]);
  const windows=new Map(),orders=[],calls=[];
  let time=at;
  const options={sources:mapping,now:()=>time,cycle:0,maxSeries:0,
    kalshi:async path=>{calls.push(path);return path.startsWith('/series')?{series:[series]}:{events:[missing,available]}},
    readTranscript:async descriptor=>descriptor.eventTicker===available.event_ticker?source('Veterans Veterans'):null,
    getWindow:async(ticker,side)=>windows.get(ticker+side),saveWindow:async proof=>windows.set(proof.eventTicker+'?'+proof.side,proof),
    onVerified:async item=>orders.push(item)};
  // Use one key for the window in this fixture.
  options.getWindow=async(_ticker,side)=>windows.get(available.event_ticker+'?'+side);
  const first=await scanMentionMarkets(options);
  assert.equal(first.sourceUnavailable,1);
  assert.equal(first.firstChecks,1);
  assert.equal(orders.length,0);
  time+=45_000;
  const second=await scanMentionMarkets(options);
  assert.equal(second.pairedChecks,1);
  assert.equal(orders.length,1);
  assert.equal(orders[0].side,'yes');
});
test('a market open today for tomorrow’s call is tracked but cannot use today’s transcript',async()=>{
  const futureTicker='KXTESTMENTION-26NOV05';
  const future={...event,event_ticker:futureTicker,strike_date:'2026-11-05T13:30:00Z',
    markets:[{...market('Baconator'),event_ticker:futureTicker}]};
  const sources=new Map([[futureTicker,{eventTicker:futureTicker,eventDate:'2026-11-05',
    timezone:'America/New_York',scheduledAt:future.strike_date}]]);
  let transcriptReads=0;
  const stats=await scanMentionMarkets({sources,now:()=>at,maxSeries:0,
    kalshi:async path=>path.startsWith('/series')?{series:[series]}:{events:[future]},
    readTranscript:async()=>{transcriptReads++;return source('Baconator',{eventTicker:futureTicker})},
    getWindow:async()=>null,saveWindow:async()=>{},onVerified:async()=>assert.fail('early order')});
  assert.equal(stats.scheduledLater,1);
  assert.equal(transcriptReads,0);
});
test('source subject and dated ticker must match the exact contract event',()=>{
  const c=mentionContract(event,market('Baconator'),series);
  assert.equal(mentionObservation(c,source('Baconator',{subject:'a different speaker'}),{now:at,side:'yes'}),null);
  assert.equal(mentionTickerDay('KXTESTMENTION-26NOV05'),'2026-11-05');
});
test('the contract’s scheduled broadcast instant controls the event day across time zones',()=>{
  const news={...event,strike_date:'2026-11-05T23:30:00Z'};
  const descriptor={eventDate:'2026-11-05',timezone:'America/New_York',scheduledAt:'2026-11-05T23:30:00Z'};
  assert.equal(mentionEventTime(news,market('Iran'),descriptor),true);
  assert.equal(mentionDay(descriptor.scheduledAt,'America/Chicago'),'2026-11-05');
  assert.equal(mentionEventTime(news,market('Iran'),{...descriptor,scheduledAt:'2026-11-05T22:30:00Z'}),false);
  assert.equal(mentionEventTime(news,market('Iran'),{...descriptor,eventDate:'2026-11-04'}),false);
});
