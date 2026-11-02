import { createHash } from 'node:crypto';
import { z } from 'zod';

const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const schema=z.object({
  schema_version:z.literal(1), logical_task_id:id, handoff_id:id,
  direction:z.enum(['requirements_to_chat','document_from_chat']),
  version:z.number().int().min(1).max(999999),parent_version:z.number().int().min(0).max(999998),
  source:z.enum(['private_agent','ordinary_chat_manual']),
  summary:z.string().trim().min(1).max(1000),body:z.string().min(1),
  body_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key:z.string().min(8).max(200),confirmation:z.literal('pending_user_review'),
}).strict();

// Offline preparation only. A digest proves byte integrity, not authorship or
// user identity. No network, browser, dispatcher or approval capability here.
export function validateChatHandoff(input,{expectedParentVersion,logicalTaskId}={}) {
  if(!Number.isInteger(expectedParentVersion)||expectedParentVersion<0||expectedParentVersion>999998)throw new Error('Expected parent version is required');
  const item=schema.parse(input);
  if(Buffer.byteLength(item.body,'utf8')>65536 || item.parent_version!==expectedParentVersion || item.version!==item.parent_version+1 ||
    (logicalTaskId!==undefined&&logicalTaskId!==item.logical_task_id))throw new Error('Handoff lineage or size mismatch');
  const source=item.direction==='requirements_to_chat'?'private_agent':'ordinary_chat_manual';
  const digest=createHash('sha256').update(item.body,'utf8').digest('hex');
  const key=`chat-handoff:${item.logical_task_id}:${item.direction}:${item.version}:${digest}`;
  if(item.source!==source||digest!==item.body_sha256||key!==item.idempotency_key)throw new Error('Handoff source or integrity mismatch');
  return {valid:true,offline_only:true,logical_task_id:item.logical_task_id,handoff_id:item.handoff_id,version:item.version,
    body_sha256:digest,idempotency_key:key,confirmation:'pending_user_review'};
}
