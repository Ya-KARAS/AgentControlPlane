import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createDeliveryEvidenceEvaluator} from '../src/core/delivery-evidence.js';
import {TaskStore} from '../src/core/store.js';
const now=Date.parse('2026-11-01T12:00:00Z');
const target={repository:'owner/repo',pull_request_number:23,head_sha:'a'.repeat(40)};
const merge={merged:true,merge_commit_sha:'b'.repeat(40),event_id:'merge-23',source:'github',occurred_at:new Date(now-500).toISOString()};
const evidence={...target,checks:'passed',complete:true,observed_at:new Date(now-100).toISOString(),valid_until:new Date(now+1000).toISOString(),decisions:[],merge};
const options=(observation=evidence)=>({clock:()=>now,adapter:{readHead:async()=>target,readObservation:async()=>structuredClone(observation)}});
test('provider merged fact is distinct from user approval and needs no user policy',async()=>{
 const result=await createDeliveryEvidenceEvaluator(options()).evaluate(target);
 assert.deepEqual(result.candidate.merge,merge);assert.equal(result.candidate.decision,'unknown');
 assert.equal(result.effective.review_state,'unknown');
});
for(const bad of [{...merge,merge_commit_sha:null},{...merge,event_id:null},{...merge,source:'manual'}, {...merge,occurred_at:new Date(now+1).toISOString()},{...merge,merged:'true'},{...merge,merged:false}])test('malformed provider merge evidence rejected '+JSON.stringify(bad),async()=>{
 assert.equal((await createDeliveryEvidenceEvaluator(options({...evidence,merge:bad})).evaluate(target)).candidate,null);
});
test('missing merge is unknown; explicit false requires null fact details',async()=>{
 const {merge:ignored,...without}=evidence;
 assert.equal((await createDeliveryEvidenceEvaluator(options(without)).evaluate(target)).candidate.merge ?? null,null);
 const negative={merged:false,merge_commit_sha:null,event_id:null,source:'github',occurred_at:null};
 assert.deepEqual((await createDeliveryEvidenceEvaluator(options({...evidence,merge:negative})).evaluate(target)).candidate.merge,negative);
});
test('merge history rejects omission or changed fact after restart and head race',async()=>{
 const first=createDeliveryEvidenceEvaluator(options());await first.evaluate(target);
 for(const next of [{...evidence,merge:undefined},{...evidence,merge:{...merge,merge_commit_sha:'c'.repeat(40)}}]){
  const restarted=createDeliveryEvidenceEvaluator({...options({...next,observed_at:new Date(now).toISOString()}),history:first.exportHistory()});
  assert.equal((await restarted.evaluate(target)).candidate,null);
 }
 const race=options();race.adapter.readHead=async()=>({...target,head_sha:'c'.repeat(40)});
 assert.equal((await createDeliveryEvidenceEvaluator(race).evaluate(target)).candidate,null);
});
test('host persists bounded merge journal and safe audit; restart still needs fresh provider',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-merged-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new TaskStore(dir);const task=store.createTask({workspace:'/private',brief:{objective:'secret'},policy:{name:'economy'}});
 store.recordDelivery(task.id,{...target,branch:'feat/x',observed_at:new Date(now-1000).toISOString()});
 const host=store.createDeliveryHost(options());await host.refresh(task.id);
 const view=store.getDelivery(task.id);assert.equal(view.merged,true);assert.equal(view.merge_commit_sha,merge.merge_commit_sha);
 assert.equal(view.review_state,'unknown');assert.equal(view.approval_supported,false);
 assert.equal(JSON.stringify(store.getTask(task.id)).includes('_delivery_evidence'),false);
 const audit=fs.readFileSync(store.auditPath,'utf8');assert.match(audit,/merge-23/);assert.match(audit,/merge_commit_sha/);
 const restarted=new TaskStore(dir);assert.notEqual(restarted.getDelivery(task.id).merged,true);
 await restarted.createDeliveryHost(options()).refresh(task.id);assert.equal(restarted.getDelivery(task.id).merged,true);
 assert.throws(()=>store.recordDelivery(task.id,{...target,branch:'feat/x',review_state:'merged',observed_at:new Date(now).toISOString()}));
});

test('merge display is a fresh provider fact without approving user review',async()=>{
 const {deliverySummaryHtml}=await import('../src/dashboard.js');
 const view={...target,source:'verified_host',verification:'verified',verified_until:'9999-01-01T00:00:00.000Z',approval_supported:false,review_state:'unknown',merged:true,merge_commit_sha:merge.merge_commit_sha};
 assert.match(deliverySummaryHtml(view),/Merged fact: true/);
 assert.doesNotMatch(deliverySummaryHtml({...view,verified_until:'2000-01-01T00:00:00.000Z'}),/Merged fact: true/);
 assert.doesNotMatch(deliverySummaryHtml({...view,verification:'unverified'}),/Merged fact: true/);
});

test('merge provider event cannot transplant to a different head after evaluator restart',async()=>{
 const first=createDeliveryEvidenceEvaluator(options());await first.evaluate(target);
 const other={...target,head_sha:'c'.repeat(40)};
 const opts=options({...evidence,...other,observed_at:new Date(now).toISOString()});opts.adapter.readHead=async()=>other;
 const restarted=createDeliveryEvidenceEvaluator({...opts,history:first.exportHistory()});
 assert.equal((await restarted.evaluate(other)).candidate,null);
});
