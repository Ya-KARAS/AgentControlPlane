import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../src/core/store.js';
const options={enabled:true,rpID:'review.test',expectedOrigin:'https://review.test'};
const credential={id:'fake-credential',publicKey:new Uint8Array([1,2,3]),counter:0};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-identity-'));const store=new TaskStore(dir);let now=2000;t.after(()=>{store.releaseExecutorLease();fs.rmSync(dir,{recursive:true,force:true});});return {dir,store,storage:store.createDeliveryIdentityStorage({...options,clock:()=>now}),clock:n=>now=n};}
const insert=(storage,extra={})=>storage.insertCredential({principalId:'private-test-user',credential,expectedAbsent:true,...extra});
const unavailable=e=>e.code==='delivery_identity_unavailable';
test('identity store is disabled without explicit host opt-in and does not persist',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-identity-off-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new TaskStore(dir),s=store.createDeliveryIdentityStorage();assert.equal(s.enabled,false);await assert.rejects(s.readCredentials('private-test-user'),unavailable);assert.equal(fs.existsSync(store.statePath),false);
});
test('private public-key credentials survive restart with binary shape and RP binding',async t=>{
 const f=setup(t);assert.deepEqual(await f.storage.readCredentials('private-test-user'),[]);assert.equal(await insert(f.storage),true);assert.equal(await insert(f.storage),false);
 const restored=new TaskStore(f.dir),storage=restored.createDeliveryIdentityStorage({...options,clock:()=>2000});const rows=await storage.readCredentials('private-test-user');assert.deepEqual(rows,[{...credential,revision:1}]);assert.ok(rows[0].publicKey instanceof Uint8Array);
 const wrong=restored.createDeliveryIdentityStorage({...options,rpID:'other.test',expectedOrigin:'https://other.test'});await assert.rejects(wrong.readCredentials('private-test-user'),unavailable);assert.equal(rows[0].counter,0);
 if(process.platform!=='win32')assert.equal(fs.statSync(restored.statePath).mode&0o777,0o600);
 const audit=fs.readFileSync(restored.auditPath,'utf8');for(const marker of ['private-test-user','fake-credential','AQID'])assert.equal(audit.includes(marker),false);
});
test('CAS revisions fence concurrent counterless authenticators and reject decreases/stale revision',async t=>{
 const f=setup(t);await insert(f.storage);const req={principalId:'private-test-user',credentialId:credential.id,expectedCounter:0,newCounter:0,expectedRevision:1};assert.deepEqual(await Promise.all([f.storage.compareAndSwapCounter(req),f.storage.compareAndSwapCounter(req)]),[true,false]);
 let row=(await f.storage.readCredentials('private-test-user'))[0];assert.equal(row.revision,2);assert.equal(await f.storage.compareAndSwapCounter({...req,expectedRevision:2,newCounter:4}),true);assert.equal(await f.storage.compareAndSwapCounter({...req,expectedCounter:4,expectedRevision:3,newCounter:3}),false);assert.equal(await f.storage.compareAndSwapCounter({...req,expectedCounter:4,newCounter:5}),false);
});
test('invalid keys and duplicate cross-user credentials cannot alter existing identity',async t=>{
 const f=setup(t);await insert(f.storage);assert.equal(await insert(f.storage,{principalId:'other-user'}),false);
 for(const c of [{...credential,id:'bad id'},{...credential,publicKey:new Uint8Array()},{...credential,counter:-1}])await assert.rejects(insert(f.storage,{credential:c}),unavailable);
 assert.equal((await f.storage.readCredentials('private-test-user')).length,1);
});
test('state and audit failures quarantine identity writes, pending persisted updates reject restart',async t=>{
 for(const phase of ['first','audit','last']){
  const f=setup(t);await insert(f.storage);const original=f.store.persist.bind(f.store);let n=0;
  if(phase==='audit')f.store.audit=()=>{throw Error('private-failure-marker');};else f.store.persist=()=>{if(++n===(phase==='first'?1:2))throw Error('private-failure-marker');return original();};
  await assert.rejects(f.storage.compareAndSwapCounter({principalId:'private-test-user',credentialId:credential.id,expectedCounter:0,newCounter:1,expectedRevision:1}),unavailable);assert.equal(f.store.checkpointFaulted,true);await assert.rejects(f.storage.readCredentials('private-test-user'),unavailable);
  const restart=new TaskStore(f.dir);await assert.rejects(restart.createDeliveryIdentityStorage({...options}).readCredentials('private-test-user'),unavailable);
  if(phase!=='first'){f.store.releaseExecutorLease();const clean=new TaskStore(f.dir);const s=clean.createDeliveryIdentityStorage({...options});await assert.rejects(s.readCredentials('private-test-user'),unavailable);clean.releaseExecutorLease();}
 }
});
test('retained audit detects state rollback and malformed private root rather than reviving old counters',async t=>{
 const f=setup(t);await insert(f.storage);const old=fs.readFileSync(f.store.statePath);await f.storage.compareAndSwapCounter({principalId:'private-test-user',credentialId:credential.id,expectedCounter:0,newCounter:2,expectedRevision:1});fs.writeFileSync(f.store.statePath,old);
 const restart=new TaskStore(f.dir);await assert.rejects(restart.createDeliveryIdentityStorage({...options}).readCredentials('private-test-user'),unavailable);restart.releaseExecutorLease();
});
