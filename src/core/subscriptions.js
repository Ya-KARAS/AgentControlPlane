import { ControlPlaneError } from './errors.js';
const invalid = () => new ControlPlaneError('invalid_subscription', 'Invalid bounded subscription snapshot or route configuration');
const slug = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
const label = value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value));
const scopeFields = ['provider','surface','account_alias','plan','model_family','quota_window'];
const fields = new Set(['schema_version',...scopeFields,'availability','remaining_percent','reset_at','observed_at','valid_until','source','confidence','overage_status']);
function timestamp(value) {
 if(typeof value !== 'string' || !/^(?:\d{4}|[+-]\d{6})-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw invalid();
 const ms=Date.parse(value); if(!Number.isFinite(ms) || new Date(ms).toISOString() !== (value.includes('.')?value:value.replace('Z','.000Z'))) throw invalid();
 return ms;
}
function normalizedScope(input) {
 const out={};
 for(const field of scopeFields) { const value=input[field]??null; if(!(field==='provider'||field==='surface'||field==='account_alias' ? slug(value) : label(value))) throw invalid(); out[field]=value; }
 return out;
}
export function subscriptionScope(input) { return JSON.stringify(scopeFields.map(field=>input[field]??null)); }
export function normalizeSubscriptionSnapshot(input,{nowMs=Date.now()}={}) {
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!fields.has(key)) || input.schema_version!==1 || !Number.isSafeInteger(nowMs)) throw invalid();
 const observed=timestamp(input.observed_at), until=timestamp(input.valid_until);
 if(observed>nowMs || until<=observed || until-observed>86400000) throw invalid();
 const remaining=input.remaining_percent??null, reset=input.reset_at??null;
 if(remaining!==null && (typeof remaining!=='number'||!Number.isFinite(remaining)||remaining<0||remaining>100)) throw invalid();
 if(reset!==null) timestamp(reset);
 if(!['available','warning','exhausted','unknown'].includes(input.availability) || !['official_diagnostic','official_ui','local_telemetry','executor_error','manual'].includes(input.source) || !['observed','inferred','user_reported'].includes(input.confidence)) throw invalid();
 const overage=input.overage_status??'unknown'; if(!['unknown','disabled','enabled'].includes(overage)) throw invalid();
 return {schema_version:1,...normalizedScope(input),availability:input.availability,remaining_percent:remaining,reset_at:reset,observed_at:new Date(observed).toISOString(),valid_until:new Date(until).toISOString(),source:input.source,confidence:input.confidence,overage_status:overage};
}
export function effectiveSubscription(input,nowMs=Date.now()) {
 const snapshot=normalizeSubscriptionSnapshot(input,{nowMs});
 const expired=Date.parse(snapshot.valid_until)<=nowMs;
 return {...snapshot,...(expired?{availability:'unknown',remaining_percent:null,reset_at:null,overage_status:'unknown'}:{}),freshness:expired?'expired':'fresh'};
}
export function normalizeSubscriptionRoutes(routes=[]) {
 if(!Array.isArray(routes)||routes.length>128) throw invalid();
 const seen=new Set();
 return routes.map(route=>{
  if(!route||!slug(route.executor)||Object.keys(route).some(key=>!['executor',...scopeFields,'compatible','previously_verified'].includes(key)) || (route.compatible!==undefined&&typeof route.compatible!=='boolean') || (route.previously_verified!==undefined&&typeof route.previously_verified!=='boolean') || seen.has(route.executor)) throw invalid();
  seen.add(route.executor); return {executor:route.executor,...normalizedScope(route),compatible:route.compatible===true,previously_verified:route.previously_verified===true};
 });
}
export function subscriptionAdvisory(routes,snapshots,nowMs=Date.now()) {
 return normalizeSubscriptionRoutes(routes).map(route=>{
  let snapshot; try { const found=snapshots.find(item=>subscriptionScope(item)===subscriptionScope(route)); if(found) snapshot=effectiveSubscription(found,nowMs); } catch { /* malformed persisted evidence never enables a route */ }
  const availability=snapshot?.availability??'unknown'; let action,reason;
  if(!route.compatible) {action='blocked';reason='capability_not_verified';}
  else if(availability==='exhausted') {action='skip';reason='subscription_exhausted';}
  else if(!route.previously_verified) {action='blocked';reason='route_not_verified';}
  else {action='approval_required';reason=snapshot?.overage_status!=='disabled'?'overage_confirmation_required':availability==='unknown'?'availability_unknown':'manual_confirmation_required';}
  return {executor:route.executor,availability,action,reason,valid_until:snapshot?.valid_until??null};
 }).sort((a,b)=>({available:0,warning:1,unknown:2,exhausted:3}[a.availability]-{available:0,warning:1,unknown:2,exhausted:3}[b.availability]));
}
export function subscriptionStatus(store,config,nowMs=Date.now()) {
 const snapshots=store.listSubscriptionSnapshots(nowMs);
 return {snapshots,advisory:subscriptionAdvisory(config.subscriptions?.routes??[],snapshots.map(({freshness,...snapshot})=>snapshot),nowMs),advisory_only:true};
}
