import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitHubDeliveryAdapter } from '../src/core/github-delivery-adapter.js';
const repository='Ya-KARAS/AgentControlPlane', head='a'.repeat(40), now=Date.parse('2026-11-01T12:00:00.000Z');
const target={repository,pull_request_number:23,head_sha:head};
const pr=()=>({number:23,base:{repo:{full_name:repository}},head:{sha:head},merged:false,merged_at:null,merge_commit_sha:'b'.repeat(40)});
const run=(id=1,name='verify')=>({id,name,head_sha:head,status:'completed',conclusion:'success',app:{id:17}});
function setup(options={}) {
 const calls=[];
 const request=async(url,init)=>{
  calls.push({url,init});
  const custom=options.respond?.(url,calls.length);
  return {status:200,url,headers:{},body:JSON.stringify(pr()),...custom};
 };
 return {calls,adapter:createGitHubDeliveryAdapter({repository,request,clock:()=>now,...options})};
}
test('unwired transport cannot access network and wrong targets are rejected before request',async()=>{
 const adapter=createGitHubDeliveryAdapter({repository});
 await assert.rejects(adapter.readObservation(target),/GitHub delivery unavailable/);
 const {adapter:a,calls}=setup();
 for(const bad of [{...target,repository:'other/repo'},{...target,pull_request_number:-1},{...target,head_sha:'../evil'}]) await assert.rejects(a.readObservation(bad));
 assert.equal(calls.length,0);
});
test('exact GETs produce provider fact with unknown checks and no user decisions',async()=>{
 const {adapter,calls}=setup();
 const result=await adapter.readObservation(target);
 assert.equal(result.checks,'unknown'); assert.deepEqual(result.decisions,[]); assert.equal(result.complete,true);
 assert.deepEqual(result.merge,{merged:false,merge_commit_sha:null,event_id:null,source:'github',occurred_at:null});
 assert.equal(result.observed_at,'2026-11-01T12:00:00.000Z');
 assert.equal(result.valid_until,'2026-11-01T12:01:00.000Z');
 assert.equal(calls.length,2);
 for(const {url,init} of calls){ assert.equal(url,'https://api.github.com/repos/Ya-KARAS/AgentControlPlane/pulls/23'); assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.ok(init.signal);assert.equal(init.body,undefined); }
 assert.deepEqual(await adapter.readHead(target),target);
});
test('affirmative merged flag plus timestamp and merge SHA required, not merge SHA alone',async()=>{
 const {adapter}=setup({respond:()=>({body:JSON.stringify({...pr(),merged:true,merged_at:'2026-11-01T11:00:00Z',merge_commit_sha:'c'.repeat(40)})})});
 const value=await adapter.readObservation(target);
 assert.equal(value.merge.merged,true);assert.equal(value.merge.merge_commit_sha,'c'.repeat(40));assert.match(value.merge.event_id,/^merge-/);
 assert.deepEqual(value.decisions,[]);
});
for(const invalid of [
 {status:403,body:'secret'}, {status:429}, {status:302}, {url:'https://evil.invalid'}, {body:'malformed'},
 ...[{number:24},{head:{sha:'b'.repeat(40)}},{base:{repo:{full_name:'other/repo'}}},{merged:true,merged_at:null},{merged:true,merged_at:'2026-11-01T13:00:00Z'},{merged:true,merged_at:'2026-11-01T11:00:00Z',merge_commit_sha:null}].map(patch=>({body:JSON.stringify({...pr(),...patch})})),
]) test(`failed/mismatched provider response closes safely ${JSON.stringify(invalid).slice(0,80)}`,async()=>{
 const {adapter}=setup({respond:()=>invalid});
 await assert.rejects(adapter.readObservation(target),error=>error.message==='GitHub delivery unavailable');
});
test('PR head changed after collection rejects observation',async()=>{
 const {adapter}=setup({respond:(_,n)=>({body:JSON.stringify(n===2?{...pr(),head:{sha:'b'.repeat(40)}}:pr())})});
 await assert.rejects(adapter.readObservation(target));
});
test('complete explicit required checks policy and bounded pagination; partial contexts never green',async()=>{
 const {adapter,calls}=setup({requiredChecks:[{name:'verify',app_id:17},{name:'lint',app_id:17}],respond:url=>url.includes('check-runs')?{
  body:JSON.stringify({total_count:2,check_runs:[url.includes('page=2')?run(2,'lint'):run()]}),
  headers:url.includes('page=2')?{}:{link:'<https://api.github.com/repos/Ya-KARAS/AgentControlPlane/commits/'+head+'/check-runs?per_page=100&page=2>; rel="next"'},
 }:undefined});
 assert.equal((await adapter.readObservation(target)).checks,'passed');assert.equal(calls.length,4);
 const missing=setup({requiredChecks:[{name:'absent',app_id:17}],respond:url=>url.includes('check-runs')?{body:JSON.stringify({total_count:1,check_runs:[run()]})}:undefined});
 assert.equal((await missing.adapter.readObservation(target)).checks,'unknown');
});
for(const item of [
 {name:'off-origin',headers:{link:'<https://evil.invalid/next>; rel="next"'}},
 {name:'wrong path',headers:{link:'<https://api.github.com/user>; rel="next"'}},
 {name:'unreported partial',total_count:2},
 {name:'head mismatch',check_runs:[{...run(),head_sha:'b'.repeat(40)}]},
 {name:'oversize',body:'x'.repeat(5000),maxBytes:1024},
 {name:'page cap',maxPages:1,headers:{link:'<https://api.github.com/repos/Ya-KARAS/AgentControlPlane/commits/'+head+'/check-runs?per_page=100&page=2>; rel="next"'}},
 {name:'record cap',maxRecords:1,total_count:2,check_runs:[run(),run(2)]},
]) test(`reject incomplete/unbounded checks ${item.name}`,async()=>{
 const {adapter}=setup({requiredChecks:[{name:'verify',app_id:17}],maxBytes:item.maxBytes??262144,maxPages:item.maxPages??10,maxRecords:item.maxRecords??1000,respond:url=>url.includes('check-runs')?{headers:item.headers??{},body:item.body??JSON.stringify({total_count:item.total_count??1,check_runs:item.check_runs??[run()]})}:undefined});
 await assert.rejects(adapter.readObservation(target));
});
test('bounded request timeout rejects a transport that never resolves',async()=>{
 const adapter=createGitHubDeliveryAdapter({repository,request:()=>new Promise(()=>{}),clock:()=>now,timeoutMs:10});
 await assert.rejects(adapter.readObservation(target),/GitHub delivery unavailable/);
});

test('same-name check from another app cannot satisfy explicit issuer-bound policy',async()=>{
 const {adapter}=setup({requiredChecks:[{name:'verify',app_id:17}],respond:url=>url.includes('check-runs')?{body:JSON.stringify({total_count:1,check_runs:[{...run(),app:{id:18}}]})}:undefined});
 assert.equal((await adapter.readObservation(target)).checks,'unknown');
});

test('merge timestamp must be a canonical provider ISO time, not Date.parse shorthand',async()=>{
 const {adapter}=setup({respond:()=>({body:JSON.stringify({...pr(),merged:true,merged_at:'2026-11-01',merge_commit_sha:'c'.repeat(40)})})});
 await assert.rejects(adapter.readObservation(target));
});
