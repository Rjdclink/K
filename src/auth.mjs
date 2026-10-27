import {createPrivateKey, sign, constants} from 'node:crypto';

export function privateKeyFromEnvironment(value) {
  const raw=String(value||'').replace(/\\n/g,'\n').trim();
  if(!raw)return null;
  const pem=raw.includes('-----BEGIN ')?raw:`-----BEGIN PRIVATE KEY-----\n${raw.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return createPrivateKey(pem);
}

export function kalshiSignature(privateKey,timestamp,method,path) {
  const key=privateKeyFromEnvironment(privateKey);
  if(!key)throw Error('Kalshi private key unavailable');
  const message=Buffer.from(String(timestamp)+method+path);
  if(key.asymmetricKeyType==='ed25519')return sign(null,message,key).toString('base64');
  if(key.asymmetricKeyType==='rsa')return sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST}).toString('base64');
  throw Error('Unsupported Kalshi signing key type');
}
