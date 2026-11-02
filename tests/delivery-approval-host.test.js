import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { TaskStore } from '../src/core/store.js';
import { ArchiveService } from '../src/core/workflow.js';
import { createDeliveryApprovalHost } from '../src/core/delivery-approval-host.js';
import { privateDeliveryFixture,decisionTarget } from './fixtures/private-delivery-fixture.js';
const target=(({decision,...t})=>t)(decisionTarget),unavailable=e=>e.code==='delivery_approval_unavailable';
function setup(t){const f=privateDeliveryFixture(t);let head=target.head_sha,allowed=true,fail=false;const calls=[];
 const provider={async readHead(input){calls.push('head');if(fail)throw Error('private-provider-error');return {...input,head_sha:head};},async readObservation(input){calls.push('observation');if(fail)throw Error('private-provider-error');return {...input,checks:'passed',complete:true,observed_at:new Date(f.now()).toISOString(),valid_until:new Date(f.now()+60000).toISOString(),decisions:[],merge:null};}};
 const opts={...f.options,store:f.store,providerAdapter:provider,rpName:'Synthetic only',library:f.library,authorize:async({principalId})=>allowed&&principalId==='synthetic-user',authorizeUser:async user=>allowed&&user==='synthetic-user'};
 const host=createDeliveryApprovalHost(opts),task=f.store.createTask({workspace:f.dir,brief:{objective:'synthetic task'},policy:{name:'economy'}});f.store.updateTask(task.id,{status:'completed',result:{summary:'synthetic result'}});f.store.recordDelivery(task.id,{...target,branch:'feat/synthetic',observed_at:new Date(f.now()).toISOString()});
 const enroll=async()=>{const s=await host.beginRegistration({principalId:'synthetic-user',target:decisionTarget});return host.finishRegistration({challengeId:s.challengeId,target:decisionTarget,response:{id:'synthetic-credential'}});};
 const decide=async(state='approved')=>{const bound={...decisionTarget,decision:state},s=await host.beginAuthentication({principalId:'synthetic-user',target:bound});return host.finishAuthentication({challengeId:s.challengeId,target:bound,response:{id:'synthetic-credential'}});};
 return {...f,opts,host,task,provider,calls,enroll,decide,setHead:v=>head=v,setAllowed:v=>allowed=v,setFailure:v=>fail=v};
}
test('host composition is default-off and constructor never polls or enrolls',async t=>{
 const f=privateDeliveryFixture(t),host=createDeliveryApprovalHost({store:f.store});assert.equal(host.enabled,false);await assert.rejects(host.beginRegistration({principalId:'synthetic-user',target:decisionTarget}),unavailable);assert.equal(fs.existsSync(f.store.statePath),false);
 const enabled=setup(t);assert.equal(enabled.host.enabled,true);assert.equal(enabled.calls.length,0);
});
test('verified user decision joins fresh provider evidence and persists across restart, never raw public identity',async t=>{
 const f=setup(t);await f.enroll();assert.equal((await f.host.refresh(f.task.id)).review_state,'unknown');await f.decide();f.clock(2001);assert.equal((await f.host.refresh(f.task.id)).review_state,'approved');
 const publicTask=JSON.stringify(f.store.getTask(f.task.id));for(const marker of ['synthetic-user','synthetic-credential','_delivery_identity'])assert.equal(publicTask.includes(marker),false);
 const restored=new TaskStore(f.dir),host=createDeliveryApprovalHost({...f.opts,store:restored});assert.equal(restored.getDelivery(f.task.id).review_state,'unknown');f.clock(2002);assert.equal((await host.refresh(f.task.id)).review_state,'approved');
});
test('decision expiry bounds cached approval, negative decisions reopen archived work and survive restart',async t=>{
 const f=setup(t);await f.enroll();await f.decide();f.clock(2001);await f.host.refresh(f.task.id);f.clock(32000);assert.equal(f.store.getDelivery(f.task.id).review_state,'unknown');await f.host.refresh(f.task.id);
 f.clock(33000);await f.decide();const service=new ArchiveService({store:f.store,orchestrator:{store:f.store,running:new Map(),queue:[]},enabled:true,clock:f.opts.clock});f.clock(33001);await service.archive(f.task.id);assert.equal(service.active().tasks.length,0);
 f.clock(34000);await f.decide('revoked');assert.equal(f.store.getDelivery(f.task.id).review_state,'unknown');assert.equal(service.active().tasks.length,1);f.clock(34001);assert.equal((await f.host.refresh(f.task.id)).review_state,'pending_review');
 const restarted=new TaskStore(f.dir),host=createDeliveryApprovalHost({...f.opts,store:restarted});f.clock(90000);assert.equal((await host.refresh(f.task.id)).review_state,'pending_review');assert.equal(restarted.getWorkflowStatus(f.task.id).active,true);
});
test('wrong HEAD failed provider or revoked policy cannot create/effect approval',async t=>{
 const f=setup(t);await f.enroll();f.setHead('b'.repeat(40));await assert.rejects(f.decide(),unavailable);f.clock(3000);f.setHead(target.head_sha);await f.decide();await f.host.refresh(f.task.id);f.setFailure(true);assert.equal((await f.host.refresh(f.task.id)).review_state,'unknown');f.setFailure(false);f.clock(3001);f.setAllowed(false);assert.equal((await f.host.refresh(f.task.id)).review_state,'unknown');
});
test('decision mutation while evaluator HEAD recheck awaits cannot install old approval',async t=>{
 const f=setup(t);await f.enroll();await f.decide();f.clock(3000);let resolve,reached;const started=new Promise(r=>{reached=r;}),original=f.provider.readHead;
 f.provider.readHead=async input=>{reached();await new Promise(r=>{resolve=r;});return original(input);};const refresh=f.host.refresh(f.task.id);await started;f.clock(4000);await f.decide('revoked');resolve();assert.equal((await refresh).review_state,'unknown');
});
test('unverified provider decisions and fake client receipts never gain authority',async t=>{
 const f=setup(t);await assert.rejects(f.host.finishAuthentication({verified:true,human:true,target:decisionTarget}),unavailable);f.provider.readObservation=async input=>({...input,checks:'passed',complete:true,observed_at:new Date(f.now()).toISOString(),valid_until:new Date(f.now()+60000).toISOString(),decisions:[{event_id:'fake',user_id:'synthetic-user',head_sha:target.head_sha,state:'approved',occurred_at:new Date(f.now()).toISOString()}]});assert.equal((await f.host.refresh(f.task.id)).review_state,'unknown');
});

test('closing a host invalidates outstanding ceremonies and cached authority without erasing history',async t=>{
 const f=setup(t);await f.enroll();await f.decide();f.clock(2001);await f.host.refresh(f.task.id);const pending=await f.host.beginAuthentication({principalId:'synthetic-user',target:decisionTarget});f.host.close();assert.equal(f.store.getDelivery(f.task.id).review_state,'unknown');await assert.rejects(f.host.finishAuthentication({challengeId:pending.challengeId,target:decisionTarget,response:{id:'synthetic-credential'}}),unavailable);assert.equal(f.host.status(f.task.id),null);assert.ok(f.store.state._delivery_identity.decisions.length);
});
test('same-millisecond revocation is durably deny-safe rather than replaying earlier approval',async t=>{
 const f=setup(t);await f.enroll();await f.decide();await f.host.refresh(f.task.id);await f.decide('revoked');assert.notEqual((await f.host.refresh(f.task.id)).review_state,'approved');f.clock(2001);assert.notEqual((await f.host.refresh(f.task.id)).review_state,'approved');
});
test('delayed approval from credential A cannot supersede later revocation on credential B',async t=>{
 const f=setup(t);await f.enroll();const reg=await f.host.beginRegistration({principalId:'synthetic-user',target:decisionTarget});await f.host.finishRegistration({challengeId:reg.challengeId,target:decisionTarget,response:{id:'credential-b'}});
 let release,reached;const started=new Promise(r=>{reached=r;}),original=f.provider.readHead;f.provider.readHead=async target=>{reached();await new Promise(r=>{release=r;});return original(target);};
 const begin=await f.host.beginAuthentication({principalId:'synthetic-user',target:decisionTarget});const delayed=f.host.finishAuthentication({challengeId:begin.challengeId,target:decisionTarget,response:{id:'synthetic-credential'}});await started;
 f.clock(3000);const negative={...decisionTarget,decision:'revoked'},n=await f.host.beginAuthentication({principalId:'synthetic-user',target:negative});await f.host.finishAuthentication({challengeId:n.challengeId,target:negative,response:{id:'credential-b'}});f.clock(4000);release();await assert.rejects(delayed,unavailable);f.provider.readHead=original;assert.notEqual((await f.host.refresh(f.task.id)).review_state,'approved');assert.equal(f.store.checkpointFaulted,false);
});
test('first observation after same-time revoke then approve is unknown rather than insertion-order approved',async t=>{
 const f=setup(t);await f.enroll();await f.decide('revoked');await f.decide('approved');f.clock(2001);assert.equal((await f.host.refresh(f.task.id)).review_state,'unknown');f.clock(3000);await f.decide('approved');f.clock(3001);assert.equal((await f.host.refresh(f.task.id)).review_state,'approved');
});
