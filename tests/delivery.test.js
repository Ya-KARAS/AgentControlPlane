import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDelivery, transitionDelivery, safeDelivery } from '../src/core/delivery.js';
const nowMs=Date.parse('2026-11-01T12:00:00Z');
const input={repository:'Ya-KARAS/AgentControlPlane',branch:'feat/task-1',pull_request_number:23,head_sha:'a'.repeat(40),observed_at:'2026-11-01T11:00:00Z'};
const opts={nowMs};
const fails=(fn,code='invalid_delivery')=>assert.throws(fn,e=>e.code===code);
test('unobserved checks/review remain unknown/not_requested even with green checks',()=>{
 const d=normalizeDelivery(input,opts); assert.equal(d.checks,'unknown');assert.equal(d.review_state,'unknown');assert.equal(d.reported_review_state,'not_requested');assert.equal(d.base_branch,null);
 assert.equal(d.source,'manual');assert.equal(d.verification,'unverified');assert.equal(d.approval_supported,false);
 assert.equal(normalizeDelivery({...input,checks:'passed'},opts).review_state,'unknown');
});
for(const review_state of ['not_requested','draft_pr','pending_review','changes_requested','closed']) test(`manual state ${review_state} is only an observation`,()=>assert.equal(normalizeDelivery({...input,review_state},opts).reported_review_state,review_state));
for(const review_state of ['approved','merged']) test(`no fabricated ${review_state}`,()=>fails(()=>normalizeDelivery({...input,review_state},opts),'human_approval_unavailable'));
for(const bad of [{human:true},{approved_by:'user'},{source:'github'},{verification:'verified'},{prompt:'secret'},{repository:'https://github.com/o/r'},{branch:'/abs/path'},{branch:'main..evil'},{branch:'a/@{x}'},{branch:'a.lock'},{branch:'-bad'},{head_sha:'bad'},{pull_request_number:0},{checks:'green'},{observed_at:'tomorrow'},{observed_at:'2026-11-02T00:00:00Z'}]) test(`reject invalid metadata ${JSON.stringify(bad)}`,()=>fails(()=>normalizeDelivery({...input,...bad},opts)));
test('canonical retries, stale and conflicting observations',()=>{
 const d=normalizeDelivery(input,opts);assert.deepEqual(transitionDelivery(d,input,opts),d);
 fails(()=>transitionDelivery(d,{...input,observed_at:'2026-11-01T10:00:00Z'},opts),'stale_delivery');
 fails(()=>transitionDelivery(d,{...input,checks:'passed'},opts),'delivery_conflict');
});
test('new head invalidates checks/review, rejected PR can continue same identity',()=>{
 const d=normalizeDelivery({...input,checks:'passed',review_state:'changes_requested'},opts);
 const next=transitionDelivery(d,{...input,head_sha:'b'.repeat(40),checks:'passed',review_state:'changes_requested',observed_at:'2026-11-01T11:01:00Z'},opts);
 assert.equal(next.checks,'unknown');assert.equal(next.reported_review_state,'pending_review');assert.equal(next.pull_request_number,23);
 for(const change of [{repository:'other/repo'},{pull_request_number:24}]) fails(()=>transitionDelivery(d,{...input,...change,observed_at:'2026-11-01T11:02:00Z'},opts),'delivery_identity_conflict');
});
test('safe reader drops corrupt or forged approval metadata',()=>{
 assert.equal(safeDelivery(null),null);assert.equal(safeDelivery({...input,prompt:'secret'}),null);assert.equal(safeDelivery({...input,review_state:'approved'}),null);
 assert.equal(safeDelivery(input).head_sha,'a'.repeat(40));
});

test('revision retry is idempotent after conservative reset without restoring stale checks',()=>{
 const previous=normalizeDelivery({...input,checks:'passed',review_state:'changes_requested'},opts);
 const observation={...input,head_sha:'b'.repeat(40),checks:'passed',review_state:'changes_requested',observed_at:'2026-11-01T11:02:00Z'};
 const stored=transitionDelivery(previous,observation,opts);
 assert.deepEqual(transitionDelivery(stored,observation,opts),stored);
 assert.equal(stored.reported_checks,'unknown');assert.equal(stored.reported_review_state,'pending_review');
 fails(()=>transitionDelivery(stored,{...observation,checks:'failed'},opts),'delivery_conflict');
 fails(()=>transitionDelivery(stored,{...observation,checks:'unknown',review_state:'pending_review'},opts),'delivery_conflict');
 fails(()=>transitionDelivery(stored,{...observation,_observation_hash:'a'.repeat(64)},opts));
});
