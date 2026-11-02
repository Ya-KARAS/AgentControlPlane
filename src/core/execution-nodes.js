import { z } from 'zod';
import { ControlPlaneError } from './errors.js';

const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const nodeSchema = z.object({
  id, kind: z.enum(['local', 'cloud']), authorized: z.boolean().default(false),
  executor_ids: z.array(id).max(16).refine(ids => new Set(ids).size === ids.length),
}).strict();
const configSchema = z.object({
  enabled: z.boolean().default(false), nodes: z.array(nodeSchema).max(64).default([]),
}).strict().refine(value => new Set(value.nodes.map(node => node.id)).size === value.nodes.length);
const observationSchema = z.object({
  node_id: id, observed_at: z.string().datetime(), valid_until: z.string().datetime(),
  online: z.boolean(), runtime_ready: z.boolean(), workspace_ready: z.boolean(),
  authentication_ready: z.boolean(), persistent: z.boolean(),
}).strict();

export function normalizeExecutionNodes(config = {}) {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new ControlPlaneError('invalid_config', 'Invalid executionNodes configuration');
  return Object.freeze({ enabled: parsed.data.enabled, nodes: Object.freeze(parsed.data.nodes.map(node =>
    Object.freeze({ ...node, executor_ids: Object.freeze([...node.executor_ids]) }))) });
}

// Host-supplied cached observations are advisory, never an ownership lease or
// permission to start a process. No I/O, clocks, background polling or task writes.
export function executionNodeView({ config, observations = [], nowMs, executorId = null, requestedNodeId = null } = {}) {
  const normalized = normalizeExecutionNodes(config);
  const base = { advisory_only: true, execution_authorized: false, selected_node_id: null, nodes: [] };
  if (!normalized.enabled) return { ...base, reason: 'disabled' };
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      (executorId !== null && !id.safeParse(executorId).success) ||
      (requestedNodeId !== null && !id.safeParse(requestedNodeId).success)) {
    return { ...base, reason: 'invalid_request' };
  }
  const usable = Array.isArray(observations) && observations.length <= 64 ? observations : [];
  const nodes = normalized.nodes.map(node => {
    const matches = usable.filter(value => value?.node_id === node.id);
    const parsed = matches.length === 1 ? observationSchema.safeParse(matches[0]) : null;
    const observation = parsed?.success ? parsed.data : null;
    let fresh = false;
    if (observation) {
      const observed = Date.parse(observation.observed_at), until = Date.parse(observation.valid_until);
      fresh = Number.isFinite(observed) && Number.isFinite(until) && observed <= nowMs &&
        until > nowMs && until > observed && until - observed <= 60_000;
    }
    let reason = !node.authorized ? 'not_authorized'
      : executorId !== null && !node.executor_ids.includes(executorId) ? 'incompatible_executor'
      : !fresh ? 'observation_unavailable'
      : !observation.online ? 'offline'
      : !observation.runtime_ready ? 'runtime_unverified'
      : !observation.workspace_ready ? 'workspace_unverified'
      : !observation.authentication_ready ? 'authentication_unverified'
      : node.kind === 'cloud' && !observation.persistent ? 'persistence_unverified'
      : 'candidate_available';
    return { ...node, executor_ids: [...node.executor_ids], reason,
      availability: reason === 'candidate_available' ? 'available' : reason === 'observation_unavailable' ? 'unknown' : 'blocked',
      observed_at: fresh ? observation.observed_at : null, valid_until: fresh ? observation.valid_until : null };
  });
  const candidate = requestedNodeId === null
    ? [...nodes].filter(node => node.availability === 'available').sort((a,b) =>
      (a.kind === 'local' ? 0 : 1) - (b.kind === 'local' ? 0 : 1) || a.id.localeCompare(b.id))[0]
    : nodes.find(node => node.id === requestedNodeId);
  const selected = candidate?.availability === 'available' ? candidate.id : null;
  return { ...base, nodes, selected_node_id: selected,
    reason: candidate?.reason ?? (requestedNodeId === null ? 'no_eligible_node' : 'node_not_registered') };
}
