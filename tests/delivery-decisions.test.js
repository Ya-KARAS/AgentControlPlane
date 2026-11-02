import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { TaskStore } from '../src/core/store.js';
import { privateDeliveryFixture,decisionTarget } from './fixtures/private-delivery-fixture.js';
const target=(({decision,...rest})=>rest)(decisionTarget),bad=e=>e.code==='delivery_identity_unavailable';
test('only fresh storage-bound verified authentication receipts create exact immutable decisions',async t=>{
 const f=privateDeliveryFixture(t),reg=await f.enroll();await assert.rejects(f.storage.recordDecision(reg),bad);const proof=await f.verify();await assert.rejects(f.storage.recordDecision(structuredClone(proof)),bad);
 const one=await f.storage.recordDecision(proof),two=await f.storage.recordDecision(proof);assert.equal(one.event.event_id,two.event.event_id);assert.equal(two.duplicate,true);assert.equal(one.event.user_id,'synthetic-user');assert.equal(one.event.head_sha,target.head_sha);
 const snapshot=await f.storage.decisionSnapshot(target);assert.equal(snapshot.complete,true);assert.equal(snapshot.decisions.length,1);assert.equal(snapshot.decisions[0].state,'approved');assert.equal((await f.storage.decisionSnapshot({...target,head_sha:'b'.repeat(40)})).decisions.length,0);
 const audit=fs.readFileSync(f.store.auditPath,'utf8');for(const value of ['synthetic-user','synthetic-credential',one.event.event_id])assert.equal(audit.includes(value),false);
});
test('expiry tombstone and revocation survive restart and clock rollback cannot revive approval',async t=>{
 const f=privateDeliveryFixture(t);await f.enroll();await f.storage.recordDecision(await f.verify());f.clock(32000);assert.equal((await f.storage.decisionSnapshot(target)).complete,false);
 let restarted=new TaskStore(f.dir),storage=restarted.createDeliveryIdentityStorage({...f.options});assert.equal((await storage.decisionSnapshot(target)).complete,false);f.clock(2000);await assert.rejects(storage.decisionSnapshot(target),bad);restarted.releaseExecutorLease();
});
test('latest verified negative event persists and is not replaced by replay of original receipt',async t=>{
 const f=privateDeliveryFixture(t);await f.enroll();const approved=await f.verify();await f.storage.recordDecision(approved);f.clock(3000);const revoked=await f.verify({...decisionTarget,decision:'revoked'});await f.storage.recordDecision(revoked);await f.storage.recordDecision(approved);
 const state=await f.storage.decisionSnapshot(target);assert.equal(state.decisions.length,1);assert.equal(state.decisions[0].state,'revoked');f.clock(70000);assert.equal((await f.storage.decisionSnapshot(target)).decisions[0].state,'revoked');const restarted=new TaskStore(f.dir),storage=restarted.createDeliveryIdentityStorage(f.options);assert.equal((await storage.decisionSnapshot(target)).decisions[0].state,'revoked');
});
test('expired and replaced-storage proofs cannot be attached, decision persistence failure is never success',async t=>{
 const f=privateDeliveryFixture(t);await f.enroll();const proof=await f.verify();f.clock(32000);await assert.rejects(f.storage.recordDecision(proof),bad);f.clock(33000);const fresh=await f.verify();const replacement=f.store.createDeliveryIdentityStorage(f.options);await assert.rejects(replacement.recordDecision(fresh),bad);await assert.rejects(f.storage.recordDecision(fresh),bad);
});
test('decision journal write/audit failure never reports recorded success or readable approval',async t=>{
 const f=privateDeliveryFixture(t);await f.enroll();const proof=await f.verify();f.store.audit=()=>{throw Error('private-error-marker');};await assert.rejects(f.storage.recordDecision(proof),bad);await assert.rejects(f.storage.decisionSnapshot(target),bad);assert.equal(f.store.checkpointFaulted,true);
});
