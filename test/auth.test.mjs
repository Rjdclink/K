import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, verify, constants} from 'node:crypto';
import {kalshiSignature} from '../src/auth.mjs';

test('Ed25519 PKCS8 base64 variable signs the exact Kalshi request',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const der=privateKey.export({type:'pkcs8',format:'der'}).toString('base64');
  const message=Buffer.from('123GET/trade-api/v2/portfolio/balance');
  const signature=kalshiSignature(der,'123','GET','/trade-api/v2/portfolio/balance');
  assert.equal(verify(null,message,publicKey,Buffer.from(signature,'base64')),true);
});

test('RSA PEM uses the Kalshi RSA-PSS signature',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const message=Buffer.from('123GET/trade-api/v2/portfolio/balance');
  const signature=kalshiSignature(privateKey.export({type:'pkcs8',format:'pem'}),'123','GET','/trade-api/v2/portfolio/balance');
  assert.equal(verify('sha256',message,{key:publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST},Buffer.from(signature,'base64')),true);
});
