import { createHash } from 'node:crypto';
import * as standardLibrary from '@simplewebauthn/server';
import { ControlPlaneError } from './errors.js';

const verifiedCeremonies=new WeakMap();
export const verifiedDeliveryCeremony=value=>value&&typeof value==='object'?verifiedCeremonies.get(value):undefined;

const unavailable = () => new ControlPlaneError('webauthn_unavailable', 'User-verification ceremony unavailable or rejected');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const credentialId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
function targetBinding(value) {
  if (!value || Object.keys(value).some(key => !['repository','pull_request_number','head_sha','decision'].includes(key)) ||
      typeof value.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.repository) ||
      !Number.isSafeInteger(value.pull_request_number) || value.pull_request_number < 1 ||
      !/^[a-f0-9]{40}$/.test(value.head_sha) || !['approved','changes_requested','revoked'].includes(value.decision)) throw unavailable();
  return Object.freeze({ repository:value.repository,pull_request_number:value.pull_request_number,head_sha:value.head_sha,decision:value.decision });
}
function validCredential(value) {
  return value && credentialId(value.id) && value.publicKey instanceof Uint8Array &&
    value.publicKey.length > 0 && value.publicKey.length <= 8192 && Number.isSafeInteger(value.counter) && value.counter >= 0 && (value.revision===undefined || Number.isSafeInteger(value.revision)&&value.revision>0);
}

// Trusted host composition only. No route, config loader or default principal/RP.
// Injected library/storage/policy are host capabilities, never request payloads.
// Optional isCurrent callbacks only restrict an individual host ceremony after
// asynchronous work; they never replace the configured authorization policy.
// The result verifies this ceremony; it is not a delivery setter or merge grant.
export function createDeliveryWebAuthnVerifier({ rpID, expectedOrigin, rpName, authorize, storage,
  clock=Date.now, ttlMs=120_000, maxPending=32, library=standardLibrary } = {}) {
  let configured=false;
  try {
    const url=new URL(expectedOrigin);
    configured=typeof rpID==='string' && rpID.length<=253 && /^[a-z0-9.-]+$/.test(rpID) &&
      url.hostname===rpID && url.origin===expectedOrigin && !url.username && !url.password &&
      (url.protocol==='https:' || (url.protocol==='http:' && rpID==='localhost')) &&
      typeof rpName==='string' && rpName.length>0 && rpName.length<=80 && !/[\x00-\x1f\x7f]/.test(rpName) &&
      typeof authorize==='function' && typeof clock==='function' &&
      ['readCredentials','insertCredential','compareAndSwapCounter'].every(key=>typeof storage?.[key]==='function') &&
      ['generateRegistrationOptions','generateAuthenticationOptions','verifyRegistrationResponse','verifyAuthenticationResponse'].every(key=>typeof library?.[key]==='function') &&
      Number.isInteger(ttlMs) && ttlMs>=30_000 && ttlMs<=300_000 && Number.isInteger(maxPending) && maxPending>=1 && maxPending<=128;
  } catch { /* Invalid/unconfigured host never creates an enabled verifier. */ }
  const pending=new Map();let generating=0,finishing=0;
  function now() { const n=clock();if(!Number.isSafeInteger(n)||n<0)throw unavailable();return n; }
  function live(record) {const n=now();if(n<record.createdAt||n>=record.expiresAt)throw unavailable();}
  async function authorized(principalId,purpose,target,isCurrent) {
    if(!configured||!id(principalId)||await authorize({principalId,purpose,target})!==true||isCurrent!==undefined&&(typeof isCurrent!=='function'||await isCurrent()!==true))throw unavailable();
  }
  async function credentials(principalId) {
    const rows=await storage.readCredentials(principalId);
    if(!Array.isArray(rows)||rows.length>64||rows.some(row=>!validCredential(row))||new Set(rows.map(row=>row.id)).size!==rows.length)throw unavailable();
    return structuredClone(rows);
  }
  async function begin(kind,{principalId,target,isCurrent}={}) {
    try {
      if(!configured)throw unavailable();
      const binding=targetBinding(target),createdAt=now();
      for(const [key,row] of pending)if(row.expiresAt<=createdAt)pending.delete(key);
      if(pending.size+generating+finishing>=maxPending)throw unavailable();
      generating++;
      try {
        await authorized(principalId,kind,binding,isCurrent);
        const rows=await credentials(principalId);
        if(kind==='authentication' && !rows.length)throw unavailable();
        const decisionFence=kind==='authentication'&&typeof storage.readDecisionFence==='function'
          ? await storage.readDecisionFence({repository:binding.repository,pull_request_number:binding.pull_request_number,head_sha:binding.head_sha}) : undefined;
        const options=kind==='registration'
          ? await library.generateRegistrationOptions({rpID,rpName,userName:principalId,userID:new TextEncoder().encode(principalId),
              attestationType:'none',supportedAlgorithmIDs:[-7,-257],timeout:ttlMs,excludeCredentials:rows.map(row=>({id:row.id})),authenticatorSelection:{userVerification:'required'}})
          : await library.generateAuthenticationOptions({rpID,timeout:ttlMs,userVerification:'required',allowCredentials:rows.map(row=>({id:row.id}))});
        if(!Number.isSafeInteger(createdAt+ttlMs))throw unavailable();
        const record={kind,principalId,target:binding,decisionFence,createdAt,expiresAt:createdAt+ttlMs};
        live(record);
        if(typeof options?.challenge!=='string'||options.challenge.length<1||options.challenge.length>1024||pending.has(options.challenge))throw unavailable();
        pending.set(options.challenge,record);
        return {challengeId:options.challenge,options};
      } finally {generating--;}
    } catch {throw unavailable();}
  }
  async function finish(kind,{challengeId,response,target,isCurrent}={}) {
    let reserved=false;
    try {
      if(!configured)throw unavailable();
      const record=pending.get(challengeId);
      pending.delete(challengeId); // Consume before ANY async work, including failure.
      if(!record)throw unavailable();
      finishing++;reserved=true; // Keep capacity while crypto/storage is in flight.
      if(record.kind!==kind||JSON.stringify(record.target)!==JSON.stringify(targetBinding(target)))throw unavailable();
      live(record);
      if(!response||typeof response!=='object'||Array.isArray(response)||JSON.stringify(response).length>65536)throw unavailable();
      await authorized(record.principalId,kind,record.target,isCurrent);
      const rows=await credentials(record.principalId);
      const verificationOptions={response,expectedChallenge:challengeId,expectedOrigin,expectedRPID:rpID,requireUserVerification:true};
      let credential,result;
      if(kind==='registration') {
        result=await library.verifyRegistrationResponse({...verificationOptions,requireUserPresence:true,supportedAlgorithmIDs:[-7,-257]});
        const info=result?.registrationInfo;
        credential=info?.credential;
        if(result?.verified!==true||info?.userVerified!==true||info.origin!==expectedOrigin||info.rpID!==rpID||!validCredential(credential)||
            response.id!==credential.id||rows.some(row=>row.id===credential.id))throw unavailable();
      } else {
        credential=rows.find(row=>row.id===response.id);
        if(!credential)throw unavailable();
        const {revision:privateRevision,...wireCredential}=credential;
        result=await library.verifyAuthenticationResponse({...verificationOptions,credential:wireCredential});
        const info=result?.authenticationInfo;
        if(result?.verified!==true||info?.userVerified!==true||info.credentialID!==credential.id||info.origin!==expectedOrigin||info.rpID!==rpID||
            !Number.isSafeInteger(info.newCounter)||info.newCounter<0||
            ((credential.counter!==0||info.newCounter!==0)&&info.newCounter<=credential.counter))throw unavailable();
      }
      await authorized(record.principalId,kind,record.target,isCurrent);
      live(record);
      const committed=kind==='registration'
        ? await storage.insertCredential({principalId:record.principalId,credential:structuredClone(credential),expectedAbsent:true})
        : await storage.compareAndSwapCounter({principalId:record.principalId,credentialId:credential.id,expectedCounter:credential.counter,newCounter:result.authenticationInfo.newCounter,...(credential.revision===undefined?{}:{expectedRevision:credential.revision})});
      if(committed!==true)throw unavailable();
      await authorized(record.principalId,kind,record.target,isCurrent);
      live(record);
      if(kind==='registration')return {verified:true,registration_only:true,credentialId:credential.id};
      const receipt=Object.freeze({verified:true,ceremony_only:true,principalId:record.principalId,credentialId:credential.id,target:record.target});
      verifiedCeremonies.set(receipt,Object.freeze({storage,rpID,expectedOrigin,principalId:record.principalId,credentialId:credential.id,target:record.target,decisionFence:record.decisionFence,credentialRevision:credential.revision===undefined?undefined:credential.revision+1,createdAt:record.createdAt,expiresAt:record.expiresAt,proofId:createHash('sha256').update(JSON.stringify([rpID,expectedOrigin,challengeId,record.principalId,record.target,record.createdAt])).digest('hex')}));
      return receipt;
    } catch {throw unavailable();}
    finally {if(reserved)finishing--;}
  }
  return Object.freeze({enabled:Boolean(configured),
    beginRegistration:input=>begin('registration',input),finishRegistration:input=>finish('registration',input),
    beginAuthentication:input=>begin('authentication',input),finishAuthentication:input=>finish('authentication',input)});
}
