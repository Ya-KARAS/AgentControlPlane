import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryEvidenceEvaluator } from '../src/core/delivery-evidence.js';
import { normalizeDelivery } from '../src/core/delivery.js';
const now = Date.parse('2026-11-01T12:00:00Z');
const target = { repository: 'owner/repo', pull_request_number: 23, head_sha: 'a'.repeat(40) };
function fixture() {
  let observation = { ...target, checks: 'passed', complete: true, observed_at: new Date(now-100).toISOString(), valid_until: new Date(now+1000).toISOString(),
    decisions: [{ event_id: 'review-1', user_id: 'user-1', head_sha: target.head_sha, state: 'approved', occurred_at: new Date(now-500).toISOString() }] };
  let head = { ...target };
  return { adapter: { async readObservation() { return structuredClone(observation); }, async readHead() { return structuredClone(head); } },
    setObservation(value) { observation = value; }, setHead(value) { head = value; }, observation,
  };
}
const evaluator = (f, options = {}) => createDeliveryEvidenceEvaluator({ adapter: f.adapter, authorizeUser: user => user === 'user-1', clock: () => now, ...options });
const unknown = result => {
  assert.equal(result.effective.checks, 'unknown'); assert.equal(result.effective.review_state, 'unknown');
  assert.equal(result.approval_supported, false); assert.equal(result.preview_only, true);
};
test('unconfigured adapter/policy cannot turn caller claims into a decision', async () => {
  unknown(await createDeliveryEvidenceEvaluator().evaluate(target));
  const f = fixture(); const result = await evaluator(f, { authorizeUser: undefined }).evaluate(target);
  unknown(result); assert.equal(result.candidate.decision, 'unknown');
});
test('explicit test host adapter and policy yield only a bound preview, never effective approval', async () => {
  const result = await evaluator(fixture()).evaluate(target);
  unknown(result); assert.deepEqual(result.candidate, { ...target, checks: 'passed', decision: 'approved', user_id: 'user-1', event_id: 'review-1' });
});
for (const mutate of [
  o => ({ ...o, repository: 'other/repo' }), o => ({ ...o, pull_request_number: 24 }),
  o => ({ ...o, head_sha: 'b'.repeat(40) }), o => ({ ...o, complete: false }),
  o => ({ ...o, valid_until: new Date(now).toISOString() }),
  o => ({ ...o, observed_at: new Date(now+1).toISOString() }),
  o => ({ ...o, decisions: [{ ...o.decisions[0], head_sha: 'b'.repeat(40) }] }),
  o => ({ ...o, decisions: [{ ...o.decisions[0], occurred_at: new Date(now+1).toISOString() }] }),
]) test('mismatched, incomplete or stale evidence fails closed', async () => {
  const f = fixture(); f.setObservation(mutate(f.observation)); const result = await evaluator(f).evaluate(target);
  unknown(result); assert.equal(result.candidate, null);
});
test('head race and later 403 never reuse a prior candidate', async () => {
  const f=fixture(), e=evaluator(f); assert.equal((await e.evaluate(target)).candidate.decision,'approved');
  f.setHead({ ...target, head_sha:'b'.repeat(40) }); assert.equal((await e.evaluate(target)).candidate,null);
  f.adapter.readObservation=async()=>{throw Object.assign(new Error('secret output'),{status:403});};
  const failed=await e.evaluate(target); assert.equal(failed.candidate,null); assert.equal(JSON.stringify(failed).includes('secret'),false);
});
test('replay is idempotent, conflicts fail closed, revocation and new heads cannot revive approval', async () => {
  const f=fixture(), e=evaluator(f); assert.equal((await e.evaluate(target)).candidate.decision,'approved');
  assert.equal((await e.evaluate(target)).candidate.decision,'approved');
  f.setObservation({ ...f.observation, decisions:[{...f.observation.decisions[0],state:'revoked'}] });
  assert.equal((await e.evaluate(target)).candidate,null);
  f.setObservation({ ...f.observation, observed_at:new Date(now-50).toISOString(), decisions:[f.observation.decisions[0],{...f.observation.decisions[0],event_id:'revoke-2',state:'revoked',occurred_at:new Date(now-100).toISOString()}] });
  assert.equal((await e.evaluate(target)).candidate.decision,'revoked');
  f.setObservation(f.observation); assert.equal((await e.evaluate(target)).candidate,null);
  f.setHead({...target,head_sha:'b'.repeat(40)}); assert.equal((await e.evaluate({...target,head_sha:'b'.repeat(40)})).candidate,null);
});
test('manual human/type/bearer claims cannot access this contract or production approval', async () => {
  const f=fixture(); f.setObservation({...f.observation,human:true,type:'User',bearer:'fake'});
  assert.equal((await evaluator(f).evaluate(target)).candidate,null);
  assert.throws(()=>normalizeDelivery({...target,branch:'feat/x',observed_at:new Date(now).toISOString(),review_state:'approved'}),e=>e.code==='human_approval_unavailable');
});

test('slow older evaluation cannot overwrite a concurrent revocation preview', async () => {
  const f=fixture(); let release;
  const gate=new Promise(resolve=>{release=resolve;}); let authorizations=0;
  const e=evaluator(f,{authorizeUser:async()=>{if(++authorizations===1) await gate; return true;}});
  const older=e.evaluate(target);
  while(authorizations===0) await new Promise(resolve=>setImmediate(resolve));
  f.setObservation({...f.observation,observed_at:new Date(now-10).toISOString(),decisions:[{...f.observation.decisions[0],event_id:'revoke-2',state:'revoked',occurred_at:new Date(now-20).toISOString()}]});
  assert.equal((await e.evaluate(target)).candidate.decision,'revoked');
  release(); assert.equal((await older).candidate,null);
});

test('clock failure after adapter/policy awaits cannot yield a candidate', async () => {
  let reads=0;
  const e=evaluator(fixture(),{clock:()=>++reads===1?now:NaN});
  assert.equal((await e.evaluate(target)).candidate,null);
});
