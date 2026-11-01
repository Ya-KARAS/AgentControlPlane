import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryWebAuthnVerifier } from '../src/core/delivery-webauthn.js';
const target={repository:'owner/repo',pull_request_number:7,head_sha:'a'.repeat(40),decision:'approved'};
function fixture(extra={}) {
 let now=1000, seq=0;
 const calls=[], credentials=[{id:'credential-1',publicKey:new Uint8Array([1,2]),counter:1}];
 const library={
  async generateRegistrationOptions(options){calls.push(['registrationOptions',options]);return {challenge:`challenge-${++seq}`};},
  async generateAuthenticationOptions(options){calls.push(['authenticationOptions',options]);return {challenge:`challenge-${++seq}`};},
  async verifyRegistrationResponse(options){calls.push(['registrationVerify',options]);return {verified:true,registrationInfo:{credential:{id:'credential-2',publicKey:new Uint8Array([3]),counter:0},userVerified:true,origin:'https://example.test',rpID:'example.test'}};},
  async verifyAuthenticationResponse(options){calls.push(['authenticationVerify',options]);return {verified:true,authenticationInfo:{credentialID:'credential-1',newCounter:2,userVerified:true,origin:'https://example.test',rpID:'example.test'}};},
 };
 const storage={async readCredentials(){return structuredClone(credentials);},async insertCredential(value){calls.push(['insert',value]);return true;},async compareAndSwapCounter(value){calls.push(['cas',value]);return true;}};
 const options={rpID:'example.test',expectedOrigin:'https://example.test',rpName:'Test only',authorize:async({principalId})=>principalId==='test-user',storage,library,clock:()=>now,ttlMs:30000,...extra};
 return {verifier:createDeliveryWebAuthnVerifier(options),calls,library,storage,setNow:n=>now=n,options};
}
const rejects=fn=>assert.rejects(fn,e=>e.code==='webauthn_unavailable');
test('no host config means no enrollment or authentication capability',async()=>{
 const v=createDeliveryWebAuthnVerifier();assert.equal(v.enabled,false);
 await rejects(()=>v.beginRegistration({principalId:'test-user',target}));
 await rejects(()=>v.beginAuthentication({principalId:'test-user',target}));
});
test('registration uses exact host RP/origin, required UV/presence and atomic insert',async()=>{
 const {verifier:v,calls}=fixture();
 const start=await v.beginRegistration({principalId:'test-user',target});
 assert.equal(calls[0][1].authenticatorSelection.userVerification,'required');
 assert.equal(calls[0][1].rpID,'example.test');
 const result=await v.finishRegistration({challengeId:start.challengeId,target,response:{id:'credential-2'}});
 assert.equal(result.registration_only,true);
 const verify=calls.find(c=>c[0]==='registrationVerify')[1];
 assert.equal(verify.expectedChallenge,start.options.challenge);assert.equal(verify.expectedOrigin,'https://example.test');
 assert.equal(verify.expectedRPID,'example.test');assert.equal(verify.requireUserVerification,true);assert.equal(verify.requireUserPresence,true);
 assert.equal(calls.find(c=>c[0]==='insert')[1].principalId,'test-user');
 await rejects(()=>v.finishRegistration({challengeId:start.challengeId,target,response:{id:'credential-2'}}));
});
test('authentication selects only host credential and advances counter before success',async()=>{
 const {verifier:v,calls}=fixture();const start=await v.beginAuthentication({principalId:'test-user',target});
 assert.equal(calls[0][1].userVerification,'required');assert.deepEqual(calls[0][1].allowCredentials,[{id:'credential-1'}]);
 const result=await v.finishAuthentication({challengeId:start.challengeId,target,response:{id:'credential-1'}});
 assert.equal(result.ceremony_only,true);assert.deepEqual(result.target,target);
 const verify=calls.find(c=>c[0]==='authenticationVerify')[1];assert.equal(verify.requireUserVerification,true);assert.equal(verify.expectedRPID,'example.test');assert.equal(verify.credential.counter,1);
 assert.deepEqual(calls.find(c=>c[0]==='cas')[1],{principalId:'test-user',credentialId:'credential-1',expectedCounter:1,newCounter:2});
});
test('unknown principal and credential never reach verifier or storage mutation',async()=>{
 const {verifier:v,calls}=fixture();await rejects(()=>v.beginAuthentication({principalId:'forged-user',target}));
 const start=await v.beginAuthentication({principalId:'test-user',target});
 await rejects(()=>v.finishAuthentication({challengeId:start.challengeId,target,response:{id:'unknown'}}));
 assert.equal(calls.some(c=>c[0]==='authenticationVerify'||c[0]==='cas'),false);
});
test('changed target consumes challenge and cannot be replayed for original head',async()=>{
 const {verifier:v}=fixture();const start=await v.beginAuthentication({principalId:'test-user',target});
 await rejects(()=>v.finishAuthentication({challengeId:start.challengeId,target:{...target,head_sha:'b'.repeat(40)},response:{id:'credential-1'}}));
 await rejects(()=>v.finishAuthentication({challengeId:start.challengeId,target,response:{id:'credential-1'}}));
});
test('exact expiry and clock rollback reject challenges',async()=>{
 for(const now of [999,31000]){const {verifier:v,setNow}=fixture();const start=await v.beginAuthentication({principalId:'test-user',target});setNow(now);await rejects(()=>v.finishAuthentication({challengeId:start.challengeId,target,response:{id:'credential-1'}}));}
});
test('persistence failure or stale counter cannot report verified decision',async()=>{
 for(const mode of ['false','throw']){const f=fixture();f.storage.compareAndSwapCounter=async()=>{if(mode==='throw')throw Error('private error');return false;};const start=await f.verifier.beginAuthentication({principalId:'test-user',target});await rejects(()=>f.verifier.finishAuthentication({challengeId:start.challengeId,target,response:{id:'credential-1'}}));}
});
test('library unverified/UV false and wrong credential binding are refused',async()=>{
 for(const info of [{verified:false},{verified:true,authenticationInfo:{credentialID:'credential-1',newCounter:2,userVerified:false}},{verified:true,authenticationInfo:{credentialID:'wrong',newCounter:2,userVerified:true}},{verified:true,authenticationInfo:{credentialID:'credential-1',newCounter:0,userVerified:true}}]){const f=fixture();f.library.verifyAuthenticationResponse=async()=>info;const s=await f.verifier.beginAuthentication({principalId:'test-user',target});await rejects(()=>f.verifier.finishAuthentication({challengeId:s.challengeId,target,response:{id:'credential-1'}}));}
});
test('revoked policy during verification and challenge capacity fail closed',async()=>{
 let allowed=true;const f=fixture({authorize:async()=>allowed,maxPending:1});const s=await f.verifier.beginAuthentication({principalId:'test-user',target});await rejects(()=>f.verifier.beginAuthentication({principalId:'test-user',target}));allowed=false;await rejects(()=>f.verifier.finishAuthentication({challengeId:s.challengeId,target,response:{id:'credential-1'}}));
});
test('real standard library generates required UV options and rejects malformed registration/authentication',async()=>{
 const f=fixture({library:undefined});const v=f.verifier;
 const reg=await v.beginRegistration({principalId:'test-user',target});assert.equal(reg.options.authenticatorSelection.userVerification,'required');assert.deepEqual(reg.options.pubKeyCredParams.map(row=>row.alg),[-7,-257]);
 await rejects(()=>v.finishRegistration({challengeId:reg.challengeId,target,response:{id:'bad'}}));
 const auth=await v.beginAuthentication({principalId:'test-user',target});assert.equal(auth.options.userVerification,'required');
 await rejects(()=>v.finishAuthentication({challengeId:auth.challengeId,target,response:{id:'credential-1'}}));
});

test('policy revoked while atomic counter commit awaits cannot produce a verified result',async()=>{
 let allowed=true;const f=fixture({authorize:async()=>allowed});
 f.storage.compareAndSwapCounter=async()=>{allowed=false;return true;};
 const s=await f.verifier.beginAuthentication({principalId:'test-user',target});
 await rejects(()=>f.verifier.finishAuthentication({challengeId:s.challengeId,target,response:{id:'credential-1'}}));
});
test('registration insert failure and UV refusal never report enrollment',async()=>{
 for(const mode of ['insert','uv']){const f=fixture();if(mode==='insert')f.storage.insertCredential=async()=>false;else f.library.verifyRegistrationResponse=async()=>({verified:true,registrationInfo:{userVerified:false}});const s=await f.verifier.beginRegistration({principalId:'test-user',target});await rejects(()=>f.verifier.finishRegistration({challengeId:s.challengeId,target,response:{id:'credential-2'}}));}
});
test('challenge cannot cross registration/authentication purposes and malformed host config stays off',async()=>{
 const f=fixture();const s=await f.verifier.beginRegistration({principalId:'test-user',target});await rejects(()=>f.verifier.finishAuthentication({challengeId:s.challengeId,target,response:{id:'credential-1'}}));
 for(const override of [{rpID:'elsewhere.test'},{expectedOrigin:'http://example.test'},{expectedOrigin:'https://example.test/path'},{authorize:undefined},{ttlMs:1},{maxPending:0}])assert.equal(fixture(override).verifier.enabled,false);
});
