import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createECDH,createDecipheriv,hkdfSync,verify,createPublicKey} from 'node:crypto';
import {favorableSettlement} from '../src/settlements.mjs';
import {vapidIdentity,validateSubscription,encryptedPush,deliverPush} from '../src/push.mjs';
import {manifest,worker} from '../src/pwa.mjs';
import {page} from '../src/ui.mjs';

test('only confirmed winning settlement with positive net revenue alerts',()=>{
  const record={market_result:'yes',yes_count_fp:'3.00',revenue:300,yes_total_cost_dollars:'2.2100',fee_cost:'0.1200'};
  assert.equal(favorableSettlement(record),67);
  assert.equal(favorableSettlement({...record,market_result:'no'}),null);
  assert.equal(favorableSettlement({...record,fee_cost:'0.7900'}),null);
  assert.equal(favorableSettlement({...record,revenue:null}),null);
});

test('push payload encrypts to the recipient key and VAPID token verifies',async()=>{
  const receiver=createECDH('prime256v1');receiver.generateKeys();
  const subscription=validateSubscription({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,7).toString('base64url')}});
  const identity=vapidIdentity('server private material');
  const body={type:'profitable-settlement',id:9,body:'Profit $1.00'};
  const data=encryptedPush(subscription,body,identity);
  const salt=data.subarray(0,16),sender=data.subarray(21,86),encrypted=data.subarray(86);
  assert.equal(data.readUInt32BE(16),4096);
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender]);
  const ikm=Buffer.from(hkdfSync('sha256',receiver.computeSecret(sender),Buffer.alloc(16,7),info,32));
  const key=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
  const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(encrypted.subarray(-16));
  const clear=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);
  assert.equal(clear.at(-1),2);
  assert.deepEqual(JSON.parse(clear.subarray(0,-1).toString()),body);
  let authorization='';
  const status=await deliverPush(subscription,body,identity,async(_endpoint,opts)=>{authorization=opts.headers.Authorization;return {status:201}});
  assert.equal(status,201);
  const token=authorization.match(/^vapid t=([^,]+), k=(.*)$/);
  assert.ok(token);
  const [header,payload,signature]=token[1].split('.');
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).aud,'https://fcm.googleapis.com');
  assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{key:createPublicKey(identity.key),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});

test('standalone install controls and opt-in push are wired without caching account data',()=>{
  const pwa=JSON.parse(manifest);
  assert.equal(pwa.display,'standalone');assert.deepEqual(pwa.icons.map(icon=>icon.sizes),['192x192','512x512']);
  assert.match(worker,/showNotification/);assert.doesNotMatch(worker,/caches\.open/);
  assert.match(page,/id="install"/);assert.match(page,/id="notifyToggle"/);assert.match(page,/id="soundToggle"/);
  assert.match(page,/beforeinstallprompt/);assert.match(page,/requestPermission\(\)/);assert.match(page,/pushManager\.subscribe/);
});

test('install button shows on-screen Android instructions when the browser has no prompt',async()=>{
  const listeners=new Map(),help={showModal(){this.open=true}},url={value:''};
  const button={classList:{add(){},remove(){}},addEventListener:(name,fn)=>listeners.set(name,fn)};
  const other={classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},style:{}};
  const document={getElementById:id=>id==='install'?button:id==='installHelp'?help:id==='installUrl'?url:other,querySelectorAll:()=>[]};
  const events=new Map(),window={matchMedia:()=>({matches:false}),addEventListener:(name,fn)=>events.set(name,fn)};
  const context=vm.createContext({document,window,location:{origin:'https://example.test'},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await listeners.get('click')();
  assert.equal(help.open,true);
  assert.equal(url.value,'https://example.test/');
  let prompted=false;help.open=false;
  events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompted=true}});
  await listeners.get('click')();
  assert.equal(prompted,true);assert.equal(help.open,false);
});

test('a previously granted browser push subscription is restored to the server on opening the dashboard',async()=>{
  const requests=[];
  const element={style:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){}};
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'key',auth:'secret'}};
  const notifications={permission:'granted'};
  const context=vm.createContext({
    document:{getElementById:()=>element,querySelectorAll:()=>[]},
    window:{Notification:notifications,addEventListener(){}},Notification:notifications,
    navigator:{serviceWorker:{register:async()=>({pushManager:{getSubscription:async()=>subscription}})}},
    localStorage:{getItem(){return null},setItem(){}},AbortSignal,setInterval(){},
    fetch:(url,options)=>{requests.push({url,options});return url==='/api/push-subscription'?Promise.resolve({ok:true}):new Promise(()=>{})}
  });
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.filter(r=>r.url==='/api/push-subscription'&&r.options?.method==='POST').length,1);
});

test('service worker presents a delivered test push as a visible device notification',async()=>{
  const handlers={},shown=[];
  const self={addEventListener:(event,handler)=>handlers[event]=handler,
    skipWaiting(){},clients:{claim(){}},registration:{showNotification:async(title,options)=>shown.push({title,options})}};
  vm.runInNewContext(worker,{self});
  let settled;
  handlers.push({data:{json:()=>({type:'test-notification',id:'test',body:'Device test'})},waitUntil:p=>settled=p});
  await settled;
  assert.equal(shown.length,1);
  assert.match(shown[0].title,/test|working/i);
  assert.equal(shown[0].options.body,'Device test');
});

test('the open-app cha-ching has two percussive strikes and a louder limited bell',()=>{
  const events={oscillators:0,clatters:0,gains:[]};
  const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>({connect(target){return target}});
  class AudioContext{
    state='running';currentTime=0;sampleRate=22050;destination=node();
    createGain(){const result={...node(),gain:parameter()};events.gains.push(result);return result}
    createDynamicsCompressor(){return {...node(),threshold:parameter(),ratio:parameter()}}
    createOscillator(){events.oscillators++;return {...node(),frequency:parameter(),start(){},stop(){}}}
    createBuffer(_channels,size){return {getChannelData:()=>new Float32Array(size)}}
    createBufferSource(){events.clatters++;return {...node(),start(){}}}
    createBiquadFilter(){return {...node(),frequency:parameter()}}
  }
  const element={classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){}};
  const context=vm.createContext({document:{getElementById:()=>element,querySelectorAll:()=>[]},window:{AudioContext,addEventListener(){}},navigator:{},localStorage:{getItem:key=>key==='kSoundEnabled'?'true':null,setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){},Math});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  vm.runInContext('ching()',context);
  assert.equal(events.clatters,2);
  assert.ok(events.oscillators>=12);
  assert.ok(events.gains.some(g=>g.gain.value>=.8));
});
