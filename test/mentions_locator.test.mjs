import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedMentionBinding,publisherHasEventMedia,proposeMentionBinding} from '../src/mentions_locator.mjs';

const source='https://investor.example.com/events';
const event={event_ticker:'KXEARNINGSMENTIONTEST-26NOV04',title:'Test earnings call',
  settlement_sources:[{name:'Test investor events',url:source}]};
const contract={subject:'any company representative'};
const page='<p>November 4, 2026 · 1:30 PM ET</p><a href="/caption.vtt">Official captions</a>';
const proposal={linkText:'Official captions',eventMarker:'Test earnings call',
  dateMarker:'November 4, 2026',eventTimeMarker:'1:30 PM ET',
  scheduledAt:'2026-11-04T18:30:00Z',timezone:'America/New_York',
  speakerMarkers:['Representative:'],segments:[{start:'Representative:',end:'END CALL'}]};

test('first discovery with no cached row is safe; only a same-day binding is reused',()=>{
  const now=Date.parse('2026-11-04T18:00:00Z');
  assert.equal(cachedMentionBinding(undefined,now),null);
  assert.equal(cachedMentionBinding({descriptor:null},now),null);
  const descriptor={eventDate:'2026-11-04',timezone:'America/New_York'};
  assert.equal(cachedMentionBinding({descriptor},now),descriptor);
  assert.equal(cachedMentionBinding({descriptor:{...descriptor,eventDate:'2026-11-03'}},now),null);
});

test('rule-named publisher must expose same-day captions before invoking Claude',async()=>{
  let calls=0;
  const fetcher=async url=>{calls++;assert.equal(String(url),source);
    return {ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>'<p>November 4, 2026</p>'}};
  assert.equal(await publisherHasEventMedia(event.settlement_sources[0],'2026-11-04',{fetcher}),false);
  assert.equal(await proposeMentionBinding(event,contract,{env:{ANTHROPIC_API_KEY:'test'},fetcher}),null);
  assert.equal(calls,2);
});

test('Claude supplies a proposal bound to the rule source, never transcript evidence',async()=>{
  let apiCalls=0;
  const fetcher=async url=>{
    if(String(url)===source)return {ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>page};
    apiCalls++;
    assert.equal(String(url),'https://api.anthropic.com/v1/messages');
    return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(proposal)}]})};
  };
  const result=await proposeMentionBinding(event,contract,{env:{ANTHROPIC_API_KEY:'test'},fetcher});
  assert.equal(apiCalls,1);
  assert.equal(result.ruleSourceUrl,source);
  assert.equal(result.discoveryUrl,source);
  assert.equal(result.eventDate,'2026-11-04');
  assert.equal(result.text,undefined);
});

test('direct publisher transcript URL can be proposed without a listing link',async()=>{
  const fetcher=async url=>{
    assert.equal(String(url),'https://api.anthropic.com/v1/messages');
    return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({
      ...proposal,linkText:undefined,url:'https://investor.example.com/events/transcript.html'})}]})};
  };
  const result=await proposeMentionBinding(event,contract,{env:{ANTHROPIC_API_KEY:'test'},fetcher,forceSearch:true});
  assert.equal(result.url,'https://investor.example.com/events/transcript.html');
  assert.equal(result.discoveryUrl,undefined);
  const bad=async()=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({
    ...proposal,linkText:undefined,url:'https://other.example.com/transcript.html'})}]})});
  assert.equal(await proposeMentionBinding(event,contract,{env:{ANTHROPIC_API_KEY:'test'},fetcher:bad,forceSearch:true}),null);
});
