import { z } from 'zod';
import { ControlPlaneError } from './errors.js';
export const identityError=()=>new ControlPlaneError('delivery_identity_unavailable','Private delivery identity operation unavailable');
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),cid=z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const credential=z.object({principalId:id,id:cid,public_key:z.string().min(4).max(10924),counter:integer,revision:integer.positive()}).strict();
export const identityDocument=z.object({version:z.literal(1),rpID:z.string(),expectedOrigin:z.string(),revision:integer,pending:z.literal(false),lastSeen:integer,credentials:z.array(credential).max(128),decisions:z.array(z.unknown()).max(256)}).strict();
export function identityBinding({rpID,expectedOrigin}={}){
 try{const u=new URL(expectedOrigin);if(typeof rpID!=='string'||!(/^[a-z0-9.-]{1,253}$/).test(rpID)||u.hostname!==rpID||u.origin!==expectedOrigin||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&rpID==='localhost'))throw Error();return {rpID,expectedOrigin};}catch{throw identityError();}
}
function normalized(input,binding){
 const d=identityDocument.parse(input??{version:1,...binding,revision:0,pending:false,lastSeen:0,credentials:[],decisions:[]});if(d.rpID!==binding.rpID||d.expectedOrigin!==binding.expectedOrigin||Buffer.byteLength(JSON.stringify(d))>1048576)throw identityError();
 const ids=new Set(),users=new Map();for(const c of d.credentials){const bytes=Buffer.from(c.public_key,'base64');if(bytes.length<1||bytes.length>8192||bytes.toString('base64')!==c.public_key||ids.has(c.id))throw identityError();ids.add(c.id);users.set(c.principalId,(users.get(c.principalId)??0)+1);}if(users.size>32||[...users.values()].some(n=>n>16))throw identityError();return d;
}
// Private host storage capabilities only, not a task/public response or identity API.
export function createPrivateDeliveryStorage({enabled=false,binding,clock=Date.now,access}={}){
 const run=async fn=>{try{if(!enabled||typeof access!=='function')throw identityError();return access(binding,raw=>{const d=normalized(raw,binding),now=clock();if(!Number.isSafeInteger(now)||now<d.lastSeen)throw identityError();return fn(d,now);});}catch{throw identityError();}};
 const update=(d,now,action,result)=>({next:normalized({...d,revision:d.revision+1,lastSeen:now},binding),action,result});
 return Object.freeze({enabled:enabled===true,
  readCredentials:principalId=>{if(!id.safeParse(principalId).success)return Promise.reject(identityError());return run(d=>({result:d.credentials.filter(c=>c.principalId===principalId).map(c=>({id:c.id,publicKey:new Uint8Array(Buffer.from(c.public_key,'base64')),counter:c.counter,revision:c.revision}))}));},
  insertCredential:input=>{
   try{if(!input||Object.keys(input).some(k=>!['principalId','credential','expectedAbsent'].includes(k))||!id.safeParse(input.principalId).success||input.expectedAbsent!==true)throw identityError();const c=input.credential;if(!c||Object.keys(c).some(k=>!['id','publicKey','counter','transports'].includes(k))||!cid.safeParse(c.id).success||!(c.publicKey instanceof Uint8Array)||c.publicKey.length<1||c.publicKey.length>8192||!integer.safeParse(c.counter).success)throw identityError();
    return run((d,now)=>{if(d.credentials.some(row=>row.id===c.id))return {result:false};d.credentials.push({principalId:input.principalId,id:c.id,public_key:Buffer.from(c.publicKey).toString('base64'),counter:c.counter,revision:1});return update(d,now,'credential_insert',true);});
   }catch{return Promise.reject(identityError());}
  },
  compareAndSwapCounter:input=>{
   if(!input||Object.keys(input).some(k=>!['principalId','credentialId','expectedCounter','newCounter','expectedRevision'].includes(k))||!id.safeParse(input.principalId).success||!cid.safeParse(input.credentialId).success)return Promise.reject(identityError());
   if(!integer.safeParse(input.expectedCounter).success||!integer.safeParse(input.newCounter).success||!integer.positive().safeParse(input.expectedRevision).success)return Promise.resolve(false);
   return run((d,now)=>{const c=d.credentials.find(c=>c.principalId===input.principalId&&c.id===input.credentialId);if(!c||c.counter!==input.expectedCounter||c.revision!==input.expectedRevision||((c.counter!==0||input.newCounter!==0)&&input.newCounter<=c.counter))return {result:false};c.counter=input.newCounter;c.revision++;return update(d,now,'counter_advanced',true);});
  },
 });
}
