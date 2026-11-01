import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryEvidenceEvaluator } from '../src/core/delivery-evidence.js';
const target={repository:'owner/repo',pull_request_number:1,head_sha:'a'.repeat(40)};
const event={event_id:'e1',user_id:'u1',head_sha:target.head_sha,state:'approved',occurred_at:'2026-11-01T00:00:00.000Z'};
const evidence={...target,checks:'passed',complete:true,observed_at:'2026-11-01T00:01:00.000Z',valid_until:'2026-11-01T00:05:00.000Z',decisions:[event,{...event,event_id:'e2',state:'revoked',occurred_at:'2026-11-01T00:00:30.000Z'}]};
test('bounded replay history survives evaluator restart and prevents omitted revocation',async()=>{
 const options={adapter:{readHead:async()=>target,readObservation:async()=>evidence},authorizeUser:async()=>true,clock:()=>Date.parse('2026-11-01T00:02:00Z')};
 const first=createDeliveryEvidenceEvaluator(options);assert.equal((await first.evaluate(target)).candidate.decision,'revoked');
 const restarted=createDeliveryEvidenceEvaluator({...options,history:first.exportHistory(),adapter:{...options.adapter,readObservation:async()=>({...evidence,observed_at:'2026-11-01T00:02:00.000Z',decisions:[event]})}});
 assert.equal((await restarted.evaluate(target)).candidate,null);
});
test('malformed or oversized persisted history fails closed without trusting injected authority',async()=>{
 for(const history of [{events:Array(257).fill(['key','x'])},{events:[['x','not-a-hash']],observations:[],latestDecisions:[]},{approved:true}]){
  const evaluator=createDeliveryEvidenceEvaluator({history});
  assert.equal((await evaluator.evaluate(target)).effective.review_state,'unknown');
  assert.throws(()=>evaluator.exportHistory());
 }
});
