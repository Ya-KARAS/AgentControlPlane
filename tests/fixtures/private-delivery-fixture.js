import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../../src/core/store.js';
import { createDeliveryWebAuthnVerifier } from '../../src/core/delivery-webauthn.js';
export const decisionTarget={repository:'owner/repo',pull_request_number:7,head_sha:'a'.repeat(40),decision:'approved'};
export function privateDeliveryFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-private-decisions-')),store=new TaskStore(dir);let now=2000,seq=0;
 const options={enabled:true,rpID:'review.test',expectedOrigin:'https://review.test',clock:()=>now,decisionTtlMs:30000};const storage=store.createDeliveryIdentityStorage(options);
 const library={generateRegistrationOptions:async()=>({challenge:`fake-${++seq}`}),generateAuthenticationOptions:async()=>({challenge:`fake-${++seq}`}),verifyRegistrationResponse:async({response})=>({verified:true,registrationInfo:{credential:{id:response.id,publicKey:new Uint8Array([1,2,3]),counter:0},userVerified:true,origin:'https://review.test',rpID:'review.test'}}),verifyAuthenticationResponse:async({credential})=>({verified:true,authenticationInfo:{credentialID:credential.id,newCounter:credential.counter+1,userVerified:true,origin:'https://review.test',rpID:'review.test'}})};
 const verifier=createDeliveryWebAuthnVerifier({...options,rpName:'Synthetic only',storage,library,authorize:async({principalId})=>principalId==='synthetic-user',ttlMs:30000});
 t.after(()=>{store.releaseExecutorLease();fs.rmSync(dir,{recursive:true,force:true});});
 const enroll=async()=>{const start=await verifier.beginRegistration({principalId:'synthetic-user',target:decisionTarget});return verifier.finishRegistration({challengeId:start.challengeId,target:decisionTarget,response:{id:'synthetic-credential'}});};
 const verify=async(target=decisionTarget)=>{const start=await verifier.beginAuthentication({principalId:'synthetic-user',target});return verifier.finishAuthentication({challengeId:start.challengeId,target,response:{id:'synthetic-credential'}});};
 return {dir,store,storage,verifier,library,options,enroll,verify,clock:n=>now=n,now:()=>now};
}
