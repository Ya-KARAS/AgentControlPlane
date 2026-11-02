import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ControlPlaneError } from './errors.js';
const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const messageFields={message_id:id,conversation_id:id,channel:z.enum(['foreground','background']),kind:z.enum(['discussion','execution_request']).default('discussion'),text:z.string().min(1).max(4096).refine(s=>s.trim().length>0&&Buffer.byteLength(s,'utf8')<=8192),task_id:z.string().uuid().nullable().optional()};
export const messageSchema=z.object(messageFields).strict();
const querySchema=z.object({conversation_id:id.optional(),channel:z.enum(['foreground','background']).optional(),limit:z.number().int().min(1).max(50).default(20)}).strict();
const error=code=>new ControlPlaneError(code,'Local message operation could not be completed');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalizeMessage(input){const parsed=messageSchema.safeParse(input);if(!parsed.success)throw error('invalid_message');return {...parsed.data,task_id:parsed.data.task_id??null};}
export const messageOperationKey=message=>`message:${digest([message.conversation_id,message.message_id])}`;
export const messageFingerprint=message=>digest([message.conversation_id,message.message_id,message.kind,message.text,message.task_id]);
export function normalizeMessageQuery(input={}){const parsed=querySchema.safeParse(input);if(!parsed.success)throw error('invalid_message_query');return parsed.data;}

// Both presentation channels share the same private journal and dispatch keys.
// Text and self-described speakers are data; this grants no actor/approval trust.
export class MessageHub{
 constructor({store,orchestrator,enabled=false,maxMessages=1024}){
  if(typeof enabled!=='boolean'||!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>4096)throw error('invalid_config');
  this.store=store;this.orchestrator=orchestrator;this.enabled=enabled;this.maxMessages=maxMessages;
 }
 post(input){if(!this.enabled)throw error('messages_disabled');return this.store.postMessage(normalizeMessage(input),this.maxMessages);}
 list(query={}){if(!this.enabled)return {enabled:false,messages:[]};return {enabled:true,messages:this.store.listMessages(normalizeMessageQuery(query))};}
 dispatch(input,request){
  if(!this.enabled)throw error('messages_disabled');const message=normalizeMessage(input);
  if(message.kind!=='execution_request'||!request||typeof request!=='object'||Array.isArray(request))throw error('invalid_message');
  this.post(message);
  const args={...request,idempotency_key:messageOperationKey(message)};
  const task=message.task_id?this.orchestrator.continueTask(message.task_id,args):this.orchestrator.dispatch(args);
  const mapped=this.store.linkMessageTask(messageOperationKey(message),task.id);
  return {message:mapped,task};
 }
}
