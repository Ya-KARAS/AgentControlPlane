import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateFromEnvelope, taskEnvelopeChanges } from '../userscript/src/conversation-protocol.js';
import { CandidateReviewService } from '../src/core/candidate-review.js';
import { normalizeBrief, buildEngineeringPrompt } from '../src/core/brief.js';
import { reviewPage } from '../src/local-review/page.js';
const envelope = { objective: 'Implement feature', context: 'Known design', constraints: ['No unrelated edits'], acceptance_criteria: ['AC1: test passes'], evidence_required: ['Command and outcome'] };
function harness() {
 const sent=[];
 const service=new CandidateReviewService({ dispatch: request => { sent.push(request); return {id:'t1'}; }, validateApproval: selection=>selection });
 return {service,sent};
}
test('web spec survives candidate approval and core prompt without flattening',()=>{
 const candidate=candidateFromEnvelope(envelope);
 assert.deepEqual(candidate.context,['Known design']);
 assert.deepEqual(candidate.acceptance_criteria,envelope.acceptance_criteria);
 assert.deepEqual(candidate.evidence_required,envelope.evidence_required);
 assert.deepEqual(candidate.constraints,envelope.constraints);
 const {service,sent}=harness();
 const created=service.create(candidate,{pageOrigin:'https://chatgpt.com'});
 const reviewed=service.beginReview(created.candidate.id,created.reviewSecret);
 service.approve(created.candidate.id,reviewed.approvalSecret,{workspace:'/test',executor:'fake'});
 const brief=normalizeBrief(sent[0]);
 assert.deepEqual(brief.context,['Known design']);
 assert.deepEqual(brief.acceptanceCriteria,envelope.acceptance_criteria);
 assert.deepEqual(brief.evidenceRequired,envelope.evidence_required);
 const prompt=buildEngineeringPrompt(brief,{maxSubagents:0});
 assert.match(prompt,/ACCEPTANCE CRITERIA:\n- AC1: test passes/);
 assert.match(prompt,/EVIDENCE REQUIRED:\n- Command and outcome/);
});
test('legacy candidate shape remains usable',()=>{
 const candidate=candidateFromEnvelope({objective:'Old',constraints:['one']});
 assert.deepEqual(candidate,{objective:'Old',constraints:['one'],source:'userscript-preview'});
 const {service}=harness();
 assert.doesNotThrow(()=>service.create(candidate,{pageOrigin:'local'}));
});
test('oversize data is rejected rather than silently truncated',()=>{
 for(const input of [{objective:'x'.repeat(4001)}, {...envelope,context:'x'.repeat(1001)}, {...envelope,acceptance_criteria:['x'.repeat(981)]}, {...envelope,constraints:Array(16).fill('constraint')}, {...envelope,execution:{model:'x'.repeat(201)}}]) assert.throws(()=>candidateFromEnvelope(input));
 const {service}=harness();
 assert.throws(()=>service.create({objective:'x',constraints:Array(16).fill('x'),context:['context'],source:'userscript-preview'},{pageOrigin:'local'}));
});
test('malformed structured lists are rejected',()=>{
 const {service}=harness();
 for(const field of ['context','acceptance_criteria','evidence_required']) {
 assert.throws(()=>candidateFromEnvelope({...envelope,[field]:{bad:true}}));
 assert.throws(()=>service.create({objective:'x',source:'userscript-preview',[field]:[1]},{pageOrigin:'local'}));
 }
});
test('changed spec sections require changed-field confirmation',()=>{
 for(const field of ['context','constraints','acceptance_criteria','evidence_required']) assert.ok(taskEnvelopeChanges(envelope,{...envelope,[field]:['changed']}).includes(field));
});
test('review page shows escaped full engineering sections',()=>{
 const candidate={...candidateFromEnvelope({...envelope,context:'<script>known</script>'}),id:'c',page_origin:'local',expires_at:'later'};
 const html=reviewPage({candidate,approvalSecret:'test',options:{},settings:{language:'en'}});
 assert.match(html,/&lt;script&gt;known&lt;\/script&gt;/);
 assert.match(html,/AC1: test passes/);
 assert.match(html,/Command and outcome/);
 assert.doesNotMatch(html,/<script>known<\/script>/);
});

test('remote worker preserves all engineering sections on its local claim path', async()=>{
 const { RemoteRelayWorker } = await import('../src/remote-relay/worker.js');
 let captured;
 const worker=new RemoteRelayWorker({
  credentials:{authorization:async()=> 'Bearer fake',current:()=>({base_url:'https://test.invalid'})},
  settings:{autoDispatchSelection:()=>({workspace:'/test'})},store:{},
  candidateReview:{create:(candidate)=>{captured=candidate;return{candidate:{id:'c1'}};},dispatchTrusted:()=>({task:{id:'t1'}})},
  fetchImpl:async()=>new Response(JSON.stringify({task:{id:'remote1',candidate:{...envelope,context:['Known design']}},lease_token:'fake-lease'}),{status:200}),
 });
 await worker.tick();
 assert.deepEqual(captured.context,['Known design']);
 assert.deepEqual(captured.acceptance_criteria,envelope.acceptance_criteria);
 assert.deepEqual(captured.evidence_required,envelope.evidence_required);
});

test('inherited Object names are not valid execution fields',()=>{
 for (const field of ['constructor','toString','__proto__']) {
  const execution=JSON.parse(`{"${field}":"unexpected"}`);
  assert.throws(()=>candidateFromEnvelope({...envelope,execution}),/candidate_execution_fields_denied/);
 }
});
