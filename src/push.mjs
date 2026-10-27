import {createHash, createECDH, createPrivateKey, hkdfSync, randomBytes, createCipheriv, sign} from 'node:crypto';

const b64=b=>Buffer.from(b).toString('base64url');
const decode=s=>Buffer.from(s,'base64url');

// Domain separation keeps the push identity stable without another deployment secret.
export function vapidIdentity(secret){
  if(!secret)throw Error('Push identity is unavailable');
  const privateKey=createHash('sha256').update('K push VAPID v1\0').update(secret).digest();
  const pair=createECDH('prime256v1');pair.setPrivateKey(privateKey);
  const publicKey=pair.getPublicKey();
  const key=createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:b64(publicKey.subarray(1,33)),y:b64(publicKey.subarray(33)),d:b64(privateKey)}});
  return {privateKey,publicKey,key,publicBase64:b64(publicKey)};
}

export function validateSubscription(value){
  if(!value || typeof value.endpoint!=='string'||value.endpoint.length>2048)throw Error('Invalid subscription');
  const endpoint=new URL(value.endpoint);
  if(endpoint.protocol!=='https:'||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','push.services.mozilla.com'].some(host=>endpoint.hostname===host||endpoint.hostname.endsWith('.'+host)))throw Error('Unsupported push service');
  if(!value.keys||typeof value.keys.p256dh!=='string'||typeof value.keys.auth!=='string'||decode(value.keys.p256dh).length!==65||decode(value.keys.auth).length<16)throw Error('Invalid push keys');
  return {endpoint:value.endpoint,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}

export function encryptedPush(subscription,message,identity,{salt=randomBytes(16),serverKey=createECDH('prime256v1')}={}){
  const receiver=decode(subscription.keys.p256dh),auth=decode(subscription.keys.auth);
  try{serverKey.getPrivateKey()}catch{serverKey.generateKeys()}
  const sender=serverKey.getPublicKey();
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),receiver,sender]);
  const ikm=Buffer.from(hkdfSync('sha256',serverKey.computeSecret(receiver),auth,info,32));
  const key=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
  const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const cipher=createCipheriv('aes-128-gcm',key,nonce);
  const content=Buffer.concat([Buffer.from(JSON.stringify(message)),Buffer.from([2])]);
  const encrypted=Buffer.concat([cipher.update(content),cipher.final(),cipher.getAuthTag()]);
  const recordSize=Buffer.alloc(4);recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt,recordSize,Buffer.from([sender.length]),sender,encrypted]);
}

export async function deliverPush(subscription,message,identity,fetcher=fetch){
  const endpoint=new URL(subscription.endpoint),origin=endpoint.origin;
  const header=b64(JSON.stringify({typ:'JWT',alg:'ES256'}));
  const payload=b64(JSON.stringify({aud:origin,exp:Math.floor(Date.now()/1000)+3600,sub:'https://github.com/Rjdclink/K'}));
  const unsigned=header+'.'+payload;
  const signature=b64(sign('sha256',Buffer.from(unsigned),{key:identity.key,dsaEncoding:'ieee-p1363'}));
  const response=await fetcher(subscription.endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','TTL':'3600','Authorization':'vapid t='+unsigned+'.'+signature+', k='+identity.publicBase64},body:encryptedPush(subscription,message,identity),signal:AbortSignal.timeout(10000)});
  return response.status;
}
