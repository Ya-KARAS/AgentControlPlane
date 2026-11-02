import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {createDeliveryApprovalHost} from './delivery-approval-host.js';
import {ControlPlaneError} from './errors.js';
const unavailable=()=>new ControlPlaneError('delivery_review_unavailable','Protected review surface unavailable');
const decision=z.enum(['approved','changes_requested','revoked']);
const beginSchema=z.object({kind:z.enum(['registration','authentication']),decision}).strict();
const finishSchema=z.object({ticket:z.string().regex(/^[a-f0-9]{64}$/),response:z.record(z.unknown())}).strict();
const taskId=z.string().uuid();
const publicFields=['repository','branch','pull_request_number','head_sha','checks','review_state','verification','verified_until','approval_supported'];
const targetOf=(delivery,state)=>({repository:delivery.repository,pull_request_number:delivery.pull_request_number,head_sha:delivery.head_sha,decision:state});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const loopback=value=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value);
function body(req){return new Promise((resolve,reject)=>{
 let size=0,parts=[],done=false;
 const fail=code=>{if(done)return;done=true;parts=[];req.pause();reject(code);};
 if(req.headers['content-encoding']||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){fail(415);return;}
 if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>73728)){fail(413);return;}
 req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>73728){fail(413);return;}parts.push(chunk);});
 req.once('end',()=>{if(done)return;done=true;try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(400);}parts=[];});
 req.once('aborted',()=>fail(400));req.once('error',()=>fail(400));
 });}
// Explicit trusted host composition only. Nothing in ordinary startup mounts this
// handler. Resolver/policies/store/provider/library are host capabilities, never
// JSON configuration, client identity flags or a shared bearer proof of humanity.
export function createProtectedDeliveryReview({enabled=false,resolveSession,authorizeTask,authorizeEnrollment=async()=>false,maxPending=32,deadlineMs=5000,...hostOptions}={}){
 if(enabled!==true)return Object.freeze({enabled:false,handle:(_req,res)=>{res.writeHead(404);res.end();},close:()=>{}});
 let origin;
 try{origin=new URL(hostOptions.expectedOrigin);if(origin.origin!==hostOptions.expectedOrigin||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||typeof resolveSession!=='function'||typeof authorizeTask!=='function'||typeof authorizeEnrollment!=='function'||!Number.isInteger(maxPending)||maxPending<1||maxPending>32||!Number.isInteger(deadlineMs)||deadlineMs<50||deadlineMs>5000)throw unavailable();}catch{throw unavailable();}
 const host=createDeliveryApprovalHost({...hostOptions,enabled:true});if(!host.enabled)throw unavailable();
 const clock=hostOptions.clock??Date.now,sessions=new Map(),tickets=new Map();let closed=false,active=0;
 const now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)throw 403;return n;};
 const purge=()=>{const at=now();for(const [key,row]of sessions)if(at<row.at||at>=row.until)sessions.delete(key);for(const [key,row]of tickets)if(at<row.at||at>=row.until)tickets.delete(key);};
 function respond(res,status,value){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',connection:'close'});res.end(JSON.stringify(value));}
 async function handle(req,res){let reserved=false,timer;
 try{
  if(closed||!loopback(req.socket.remoteAddress)||!loopback(req.socket.localAddress)||req.headers.host!==origin.host||req.headers.origin!==undefined&&req.headers.origin!==origin.origin)throw 403;
  if((req.rawHeaders?.length??0)>64||req.url.length>256||Buffer.byteLength(JSON.stringify(req.headers))>8192)throw 400;
  if(active>=8)throw 503;active++;reserved=true;timer=setTimeout(()=>{respond(res,408,{error:'review_unavailable'});req.destroy();},deadlineMs);timer.unref();
  const alive=()=>{if(closed||res.destroyed||res.writableEnded)throw 403;};
  const url=new URL(req.url,origin);if(url.origin!==origin.origin||url.search||url.hash)throw 404;
  const session=await resolveSession(req);alive();
  if(!session||Object.keys(session).some(k=>!['principalId','sessionId'].includes(k))||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(session.principalId??'')||typeof session.sessionId!=='string'||session.sessionId.length<1||session.sessionId.length>128||/[\x00-\x20\x7f]/.test(session.sessionId))throw 403;
  purge();const key=JSON.stringify([session.principalId,session.sessionId]);
  if(req.method==='GET'&&url.pathname==='/review'){
   const {deliveryReviewHtml}=await import('../delivery-review-page.js');alive();res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',connection:'close','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(deliveryReviewHtml);return;
  }
  const match=url.pathname.match(/^\/review\/api\/([^/]+)(?:\/(begin|finish))?$/);if(!match||!taskId.safeParse(match[1]).success)throw 404;
  const id=match[1],action=match[2];if(await authorizeTask(session.principalId,id)!==true)throw 403;alive();
  const delivery=hostOptions.store.getDelivery(id);if(!delivery)throw 404;
  if(req.method==='GET'&&!action){
   await host.refresh(id);alive();if(await authorizeTask(session.principalId,id)!==true)throw 403;alive();
   if(!sessions.has(key)&&sessions.size>=maxPending)throw 503;const at=now();sessions.set(key,{csrf:randomBytes(32).toString('hex'),at,until:at+120000});
   const enrollment_allowed=await authorizeEnrollment(session.principalId,id)===true;alive();
   const current=hostOptions.store.getDelivery(id);sessions.get(key).review={id,target:targetOf(current,'approved')};respond(res,200,{csrf:sessions.get(key).csrf,delivery:Object.fromEntries(publicFields.filter(k=>Object.hasOwn(current,k)).map(k=>[k,current[k]])),enrollment_allowed});return;
  }
  if(req.method!=='POST'||!action)throw 404;
  if(req.headers.origin!==origin.origin||req.headers['x-acp-review-csrf']!==sessions.get(key)?.csrf||!sessions.has(key))throw 403;
  const raw=await body(req);alive();purge();if(!sessions.has(key)||await authorizeTask(session.principalId,id)!==true)throw 403;alive();
  const currentGuard=(kind,target)=>async()=>{const fresh=await resolveSession(req);alive();purge();if(!fresh||fresh.principalId!==session.principalId||fresh.sessionId!==session.sessionId||!sessions.has(key)||!equal(target,targetOf(hostOptions.store.getDelivery(id),target.decision))||await authorizeTask(session.principalId,id)!==true||kind==='registration'&&await authorizeEnrollment(session.principalId,id)!==true)return false;alive();return true;};
  if(action==='begin'){
   const parsed=beginSchema.safeParse(raw);if(!parsed.success)throw 400;
   if(tickets.size>=maxPending)throw 503;const {kind,decision:state}=parsed.data,target=targetOf(hostOptions.store.getDelivery(id),state);const viewed=sessions.get(key)?.review;if(!viewed||viewed.id!==id||!equal(viewed.target,targetOf(hostOptions.store.getDelivery(id),'approved')))throw 400;
   if(kind==='registration'&&await authorizeEnrollment(session.principalId,id)!==true)throw 403;alive();
   const ticket=randomBytes(32).toString('hex'),at=now(),record={key,id,kind,target,at,until:at+120000,start:null};tickets.set(ticket,record);
   try{const start=await host[kind==='registration'?'beginRegistration':'beginAuthentication']({principalId:session.principalId,target,isCurrent:currentGuard(kind,target)});alive();purge();if(tickets.get(ticket)!==record||!equal(target,targetOf(hostOptions.store.getDelivery(id),state))||await authorizeTask(session.principalId,id)!==true||kind==='registration'&&await authorizeEnrollment(session.principalId,id)!==true)throw 400;alive();record.start=start;respond(res,200,{ticket,options:start.options});}catch(error){tickets.delete(ticket);throw error;}return;
  }
  const parsed=finishSchema.safeParse(raw);if(!parsed.success)throw 400;const record=tickets.get(parsed.data.ticket);if(!record||record.id!==id||!record.start)throw 400;if(record.key!==key)throw 403;tickets.delete(parsed.data.ticket);
  if(!equal(record.target,targetOf(hostOptions.store.getDelivery(id),record.target.decision)))throw 400;
  if(record.kind==='registration'&&await authorizeEnrollment(session.principalId,id)!==true)throw 403;alive();
  await host[record.kind==='registration'?'finishRegistration':'finishAuthentication']({challengeId:record.start.challengeId,target:record.target,response:parsed.data.response,isCurrent:currentGuard(record.kind,record.target)});alive();
  respond(res,200,{recorded:true,registration_only:record.kind==='registration'});
 }catch(error){respond(res,[400,403,404,408,413,415,503].includes(error)?error:400,{error:'review_unavailable'});}
 finally{clearTimeout(timer);if(reserved)active--;}
 }
 return Object.freeze({enabled:true,handle,close:()=>{closed=true;sessions.clear();tickets.clear();host.close();}});
}
