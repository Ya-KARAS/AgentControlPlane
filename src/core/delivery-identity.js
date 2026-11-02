import { createHash } from 'node:crypto';
import { verifiedDeliveryCeremony } from './delivery-webauthn.js';
import { z } from 'zod';
import { ControlPlaneError } from './errors.js';
export const identityError=()=>new ControlPlaneError('delivery_identity_unavailable','Private delivery identity operation unavailable');
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),cid=z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const credential=z.object({principalId:id,id:cid,public_key:z.string().min(4).max(10924),counter:integer,revision:integer.positive()}).strict();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const repository=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const head=z.string().regex(/^[a-f0-9]{40}$/),hex=z.string().regex(/^[a-f0-9]{64}$/);
const targetSchema=z.object({repository,pull_request_number:integer.positive(),head_sha:head}).strict();
const eventSchema=z.object({event_id:z.string().regex(/^uv-[a-f0-9]{64}$/),user_id:id,head_sha:head,state:z.enum(['approved','changes_requested','revoked']),occurred_at:z.string().refine(s=>Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)).toISOString()===s)}).strict();
const decisionRow=z.object({repository,pull_request_number:integer.positive(),event:eventSchema,proof_id:hex,credential_hash:hex,expiresAt:integer,expired:z.boolean()}).strict();
export const identityDocument=z.object({version:z.literal(1),rpID:z.string(),expectedOrigin:z.string(),revision:integer,pending:z.literal(false),lastSeen:integer,credentials:z.array(credential).max(128),decisions:z.array(decisionRow).max(256)}).strict();
export function identityBinding({rpID,expectedOrigin}={}){
 try{const u=new URL(expectedOrigin);if(typeof rpID!=='string'||!(/^[a-z0-9.-]{1,253}$/).test(rpID)||u.hostname!==rpID||u.origin!==expectedOrigin||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&rpID==='localhost'))throw Error();return {rpID,expectedOrigin};}catch{throw identityError();}
}
function normalized(input,binding){
 const d=identityDocument.parse(input??{version:1,...binding,revision:0,pending:false,lastSeen:0,credentials:[],decisions:[]});if(d.rpID!==binding.rpID||d.expectedOrigin!==binding.expectedOrigin||Buffer.byteLength(JSON.stringify(d))>1048576)throw identityError();
 const ids=new Set(),users=new Map();for(const c of d.credentials){const bytes=Buffer.from(c.public_key,'base64');if(bytes.length<1||bytes.length>8192||bytes.toString('base64')!==c.public_key||ids.has(c.id))throw identityError();ids.add(c.id);users.set(c.principalId,(users.get(c.principalId)??0)+1);}if(users.size>32||[...users.values()].some(n=>n>16))throw identityError();const events=new Set();for(const row of d.decisions){const at=Date.parse(row.event.occurred_at);if(events.has(row.proof_id)||row.event.event_id!=='uv-'+row.proof_id||at>d.lastSeen||row.expiresAt<=at||row.expiresAt-at>600000||!d.credentials.some(c=>c.principalId===row.event.user_id&&hash(c.id)===row.credential_hash))throw identityError();events.add(row.proof_id);}return d;
}
// Private host storage capabilities only, not a task/public response or identity API.
export function createPrivateDeliveryStorage({enabled=false,binding,clock=Date.now,access,revoke,decisionTtlMs=120000}={}){
 const run=async fn=>{try{if(!enabled||typeof access!=='function'||!Number.isInteger(decisionTtlMs)||decisionTtlMs<30000||decisionTtlMs>600000)throw identityError();return access(binding,raw=>{const d=normalized(raw,binding),now=clock();if(!Number.isSafeInteger(now)||now<d.lastSeen)throw identityError();return fn(d,now);});}catch{throw identityError();}};
 const update=(d,now,action,result)=>({next:normalized({...d,revision:d.revision+1,lastSeen:now},binding),action,result});
 const api=Object.freeze({enabled:enabled===true,close:()=>revoke?.(),
  currentRevision:()=>{try{if(!enabled)throw identityError();return access(binding,raw=>{const d=normalized(raw,binding),now=clock();if(!Number.isSafeInteger(now)||now<d.lastSeen)throw identityError();return {result:d.revision};});}catch{throw identityError();}},
  recordDecision:receipt=>{
   const proof=verifiedDeliveryCeremony(receipt);let now;
   try{now=clock();if(!proof||proof.storage!==api||proof.rpID!==binding.rpID||proof.expectedOrigin!==binding.expectedOrigin||!Number.isSafeInteger(now)||now<proof.createdAt||now>=proof.expiresAt)throw identityError();}catch{return Promise.reject(identityError());}
   return run((d,now)=>{
    const duplicate=d.decisions.find(r=>r.proof_id===proof.proofId);if(duplicate)return {result:{recorded:true,duplicate:true,event:structuredClone(duplicate.event)}};
    const c=d.credentials.find(c=>c.id===proof.credentialId&&c.principalId===proof.principalId);
    if(!c||c.revision!==proof.credentialRevision||now<proof.createdAt||now>=proof.expiresAt||now+decisionTtlMs>=8.64e15||d.decisions.length>=256)throw identityError();
    const event={event_id:'uv-'+proof.proofId,user_id:proof.principalId,head_sha:proof.target.head_sha,state:proof.target.decision,occurred_at:new Date(now).toISOString()};
    d.decisions.push({repository:proof.target.repository,pull_request_number:proof.target.pull_request_number,event,proof_id:proof.proofId,credential_hash:hash(proof.credentialId),expiresAt:now+decisionTtlMs,expired:false});
    return {...update(d,now,'decision_recorded',{recorded:true,duplicate:false,event:structuredClone(event)}),decision:{...proof.target,user_id:proof.principalId,event_id:event.event_id}};
   });
  },
  decisionSnapshot:input=>{
   const parsed=targetSchema.safeParse(input);if(!parsed.success)return Promise.reject(identityError());const target=parsed.data;
   return run((d,now)=>{
    let changed=false;for(const r of d.decisions)if(r.event.state==='approved'&&!r.expired&&now>=r.expiresAt){r.expired=true;changed=true;}
    const latest=new Map();for(const r of d.decisions)if(r.repository===target.repository&&r.pull_request_number===target.pull_request_number&&r.event.head_sha===target.head_sha){const old=latest.get(r.event.user_id);if(!old||old.event.occurred_at<=r.event.occurred_at)latest.set(r.event.user_id,r);}
    const complete=![...latest.values()].some(r=>r.expired&&r.event.state==='approved'),result={complete,revision:d.revision+(changed?1:0),valid_until:Math.min(...[...latest.values()].filter(r=>r.event.state==='approved'&&!r.expired).map(r=>r.expiresAt)),decisions:complete?[...latest.values()].map(r=>structuredClone(r.event)):[]};
    return changed?update(d,now,'decision_expired',result):{result};
   });
  },
  readCredentials:principalId=>{if(!id.safeParse(principalId).success)return Promise.reject(identityError());return run(d=>({result:d.credentials.filter(c=>c.principalId===principalId).map(c=>({id:c.id,publicKey:new Uint8Array(Buffer.from(c.public_key,'base64')),counter:c.counter,revision:c.revision}))}));},
  insertCredential:input=>{
   try{if(!input||Object.keys(input).some(k=>!['principalId','credential','expectedAbsent'].includes(k))||!id.safeParse(input.principalId).success||input.expectedAbsent!==true)throw identityError();const c=input.credential;if(!c||Object.keys(c).some(k=>!['id','publicKey','counter','transports'].includes(k))||!cid.safeParse(c.id).success||!(c.publicKey instanceof Uint8Array)||c.publicKey.length<1||c.publicKey.length>8192||!integer.safeParse(c.counter).success)throw identityError();
    return run((d,now)=>{if(d.credentials.some(row=>row.id===c.id)||d.credentials.length>=128||d.credentials.filter(r=>r.principalId===input.principalId).length>=16||!d.credentials.some(r=>r.principalId===input.principalId)&&new Set(d.credentials.map(r=>r.principalId)).size>=32)return {result:false};d.credentials.push({principalId:input.principalId,id:c.id,public_key:Buffer.from(c.publicKey).toString('base64'),counter:c.counter,revision:1});return update(d,now,'credential_insert',true);});
   }catch{return Promise.reject(identityError());}
  },
  compareAndSwapCounter:input=>{
   if(!input||Object.keys(input).some(k=>!['principalId','credentialId','expectedCounter','newCounter','expectedRevision'].includes(k))||!id.safeParse(input.principalId).success||!cid.safeParse(input.credentialId).success)return Promise.reject(identityError());
   if(!integer.safeParse(input.expectedCounter).success||!integer.safeParse(input.newCounter).success||!integer.positive().safeParse(input.expectedRevision).success)return Promise.resolve(false);
   return run((d,now)=>{const c=d.credentials.find(c=>c.principalId===input.principalId&&c.id===input.credentialId);if(!c||c.counter!==input.expectedCounter||c.revision!==input.expectedRevision||((c.counter!==0||input.newCounter!==0)&&input.newCounter<=c.counter))return {result:false};c.counter=input.newCounter;c.revision++;return update(d,now,'counter_advanced',true);});
  },
 });
 return api;
}
