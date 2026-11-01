import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSubscriptionSnapshot as normalize, effectiveSubscription as effective, subscriptionScope as scope, subscriptionAdvisory as advice } from '../src/core/subscriptions.js';
const now = Date.parse('2026-11-01T12:00:00Z');
const snapshot = {schema_version:1,provider:'anthropic',surface:'claude_code',account_alias:'personal',plan:null,availability:'available',remaining_percent:null,reset_at:null,observed_at:'2026-11-01T12:00:00.000Z',valid_until:'2026-11-01T12:10:00.000Z',source:'manual',confidence:'user_reported'};
const normal = (extra={}) => normalize({...snapshot,...extra},{nowMs:now});
const route = {executor:'claude',provider:'anthropic',surface:'claude_code',account_alias:'personal',compatible:true,previously_verified:true};
test('manual normalization preserves null, zero and scoped identity without inferring reset',()=>{
 assert.equal(normal().remaining_percent,null); assert.equal(normal({remaining_percent:0}).remaining_percent,0);
 assert.equal(normal().reset_at,null); assert.equal(normal().overage_status,'unknown');
 for(const extra of [{plan:'pro'},{account_alias:'other'},{model_family:'sonnet'},{quota_window:'five-hour'}]) assert.notEqual(scope(normal(extra)),scope(normal()));
});
test('exact expiry degrades green to unknown and clears quantitative/reset claims without mutation',()=>{
 const input=normal({remaining_percent:50,reset_at:'2026-11-01T13:00:00.000Z'});
 const output=effective(input,now+600000); assert.equal(output.availability,'unknown'); assert.equal(output.remaining_percent,null); assert.equal(output.reset_at,null); assert.equal(output.freshness,'expired'); assert.equal(input.availability,'available');
});
for(const extra of [{remaining_percent:-1},{remaining_percent:101},{remaining_percent:'50'},{source:'scrape'},{confidence:'certain'},{availability:'green'},{token:'secret'},{provider:'a/b'},{account_alias:'someone@example.com'},{observed_at:'2027-01-01T00:00:00Z'},{valid_until:'2026-11-01T11:59:00Z'},{valid_until:'2026-11-03T12:00:00Z'},{reset_at:'tomorrow'},{overage_status:'free'}]) test('rejects malformed snapshot '+JSON.stringify(extra),()=>assert.throws(()=>normal(extra),e=>e.code==='invalid_subscription'));
test('routing checks compatibility before quota and never guesses executor mapping',()=>{
 assert.deepEqual(advice([{...route,compatible:false}],[normal()],now).map(x=>x.action),['blocked']);
 assert.equal(advice([{...route,plan:'different'}],[normal()],now)[0].availability,'unknown');
 assert.equal(advice([route],[normal({availability:'exhausted'})],now)[0].action,'skip');
 assert.equal(advice([route],[],now)[0].action,'approval_required');
 assert.equal(advice([{...route,previously_verified:false}],[],now)[0].action,'blocked');
});
test('manual available is preferred but always requests approval, including overage risk',()=>{
 const rows=advice([{...route,executor:'unknown',plan:'other'},route],[normal({overage_status:'disabled'})],now);
 assert.equal(rows[0].executor,'claude'); assert.equal(rows[0].action,'approval_required');
 for(const overage_status of ['enabled','unknown']) assert.equal(advice([route],[normal({overage_status})],now)[0].reason,'overage_confirmation_required');
 assert.equal(advice([route],[normal({availability:'warning'})],now)[0].action,'approval_required');
});
