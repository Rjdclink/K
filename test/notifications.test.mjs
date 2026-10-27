import test from 'node:test';
import assert from 'node:assert/strict';
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
