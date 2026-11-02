import { createDeliveryWebAuthnVerifier, verifiedDeliveryCeremony } from './delivery-webauthn.js';
import { identityBinding } from './delivery-identity.js';
import { ControlPlaneError } from './errors.js';
const fail=()=>new ControlPlaneError('delivery_approval_unavailable','Verified delivery decision unavailable');
const targetOf=({repository,pull_request_number,head_sha})=>({repository,pull_request_number,head_sha});
const same=(a,b)=>a&&b&&a.repository===b.repository&&a.pull_request_number===b.pull_request_number&&a.head_sha===b.head_sha;
// Trusted host composition ONLY. This factory is never selected by JSON config,
// ordinary startup, CLI/MCP/HTTP arguments or a claimed human/controller flag.
export function createDeliveryApprovalHost({enabled=false,store,providerAdapter,authorize,authorizeUser,rpID,expectedOrigin,rpName,clock=Date.now,decisionTtlMs=120000,library}={}){
 if(enabled!==true){const off=async()=>{throw fail();};return Object.freeze({enabled:false,close:()=>{},beginRegistration:off,finishRegistration:off,beginAuthentication:off,finishAuthentication:off,refresh:off,status:()=>null});}
 try{
  identityBinding({rpID,expectedOrigin});if(!store||typeof providerAdapter?.readHead!=='function'||typeof providerAdapter?.readObservation!=='function'||typeof authorize!=='function'||typeof authorizeUser!=='function'||!Number.isInteger(decisionTtlMs)||decisionTtlMs<30000||decisionTtlMs>600000)throw fail();
  let closed=false;
  const storage=store.createDeliveryIdentityStorage({enabled:true,rpID,expectedOrigin,clock,decisionTtlMs});
  const verifier=createDeliveryWebAuthnVerifier({rpID,expectedOrigin,rpName,authorize,storage,clock,library});if(!verifier.enabled)throw fail();
  const versions=new WeakMap();
  const adapter=Object.freeze({
   async readObservation(target){
    const facts=await providerAdapter.readObservation(target);
    if(!facts||!Array.isArray(facts.decisions)||facts.decisions.length!==0)throw fail();
    const snapshot=await storage.decisionSnapshot(target);
    versions.set(target,snapshot.revision);
    const until=Math.min(Date.parse(facts.valid_until),snapshot.valid_until);
    return {...facts,complete:facts.complete===true&&snapshot.complete,valid_until:new Date(until).toISOString(),decisions:snapshot.decisions};
   },
   async readHead(target){const head=await providerAdapter.readHead(target);if(versions.get(target)!==storage.currentRevision())throw fail();return head;},
   validateCurrent:target=>versions.has(target)&&versions.get(target)===storage.currentRevision(),
  });
  const delivery=store.createDeliveryHost({adapter,authorizeUser,clock});
  const safe=fn=>async input=>{try{if(closed)throw fail();const result=await fn(input);if(closed)throw fail();return result;}catch{throw fail();}};
  return Object.freeze({enabled:true,close:()=>{closed=true;storage.close();delivery.invalidate();},
   beginRegistration:safe(input=>verifier.beginRegistration(input)),finishRegistration:safe(input=>verifier.finishRegistration(input)),
   beginAuthentication:safe(input=>verifier.beginAuthentication(input)),
   finishAuthentication:safe(async input=>{
    const receipt=await verifier.finishAuthentication(input),proof=verifiedDeliveryCeremony(receipt);if(!proof)throw fail();const target=targetOf(proof.target);
    if(await authorizeUser(proof.principalId,target)!==true)throw fail();
    // Revocation is valid for its authenticated exact revision even if the
    // provider is unavailable or has moved on. Positive consent rechecks HEAD.
    if(proof.target.decision==='approved'&&!same(target,await providerAdapter.readHead(target)))throw fail();
    if(await authorize({principalId:proof.principalId,purpose:'decision',target:proof.target})!==true||await authorizeUser(proof.principalId,target)!==true)throw fail();
    if(input?.isCurrent!==undefined&&(typeof input.isCurrent!=='function'||await input.isCurrent()!==true))throw fail();
    const result=await storage.recordDecision(receipt);if(result.recorded!==true)throw fail();return result;
   }),
   refresh:safe(id=>delivery.refresh(id)),status:id=>closed?null:delivery.status(id),
  });
 }catch{throw fail();}
}
